# Habena Dashboard App-Shell Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wrap the local dashboard in a persistent left nav + top status bar, add an Overview landing page, and migrate the decision stream to `/decisions` with TanStack-Table filters, a density toggle, and a row→drawer policy-"why" drill-down — plus a ⌘K command palette.

**Architecture:** All new behavior is **client-side over the existing API routes** (`/api/summary`, `/api/decisions`, `/api/approvals`) — **no backend changes**. A client `AppShell` (nav + status bar + ⌘K) is rendered in the root layout and wraps every page. The decision table uses `@tanstack/react-table` with in-memory filtering/sorting over the rows already fetched. The drill-down is a hand-rolled accessible drawer (no Radix). Tests use jsdom + React Testing Library.

**Tech Stack:** Next.js 16 (App Router) · React 19 · Tailwind v4 (existing token ramp in `globals.css`) · `@tanstack/react-table` · `cmdk` · Vitest + jsdom + `@testing-library/react` + `@testing-library/jest-dom`. Reuses the existing hand-rolled `Badge`/`Button`/`Card` primitives.

**Design doc:** `docs/plans/2026-06-09-habena-dashboard-app-shell-design.md`

---

## Environment & conventions (read first)

Claude Code Bash sandbox. Per the `habena-sandbox-testing-gotchas` memory:
- **Deps are already installed & committed** (`@tanstack/react-table`, `cmdk`, `jsdom`, `@testing-library/{react,dom,jest-dom}`). **Never run npm/pnpm install** — network to the registry is blocked.
- Run tests: `cd packages/web && timeout 120 npx vitest run [file] 2>&1 | tail -25; echo EXIT=$?`. If output is swallowed, re-run with `--reporter=json --outputFile=/tmp/claude-1000/r.json` and read the JSON, or dispatch a subagent.
- Type-check: `cd packages/web && timeout 120 npx tsc -p tsconfig.json --noEmit > /tmp/claude-1000/tsc.log 2>&1; echo EXIT=$?; cat /tmp/claude-1000/tsc.log` (zsh `PIPESTATUS` is unreliable with `tail`; redirect to a file for a trustworthy exit code).
- **Cannot run `next dev`/`next build` for iteration** — `next build` is run once in the final sweep (it needs the sandbox off; that's the controller's job, not a per-task step). `/tmp` is read-only; use `/tmp/claude-1000/`.
- Ignore untracked dotfiles in `git status` (sandbox `/dev/null` bind-mounts). Commit with trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Validated test recipe (already smoke-tested by the controller):**
- Component test files start with the docblock `// @vitest-environment jsdom` (the default env stays `node` so the lib/route tests are unaffected).
- jest-dom matchers (`toBeInTheDocument`, `toHaveTextContent`, …) come from a `setupFiles` entry — Task 1 wires it.
- `next/navigation` (`usePathname`, `useRouter`) must be mocked in tests with `vi.mock("next/navigation", …)`.

**Existing API shapes (do not change):**
- `GET /api/summary` → `{ ok, summary: { totalDecisions, allowed, denied, approvalPending, byAgent[], byTool[] } | null, reason?, hint? }`.
- `GET /api/decisions?limit=100` → `{ ok, rows: Decision[], reason?, hint? }` where `Decision = { id, timestamp, agentType, instanceId, tool, mcpServer, decision, tier, ruleMatched, reason, latencyMs, resultStatus }`.
- `GET /api/approvals` → `{ ok, pending: SerializedPendingApproval[], reason?, hint? }`.

---

## Task 1: jsdom + RTL test setup

**Files:**
- Create: `packages/web/src/test-setup.ts`
- Modify: `packages/web/vitest.config.ts`
- Test: `packages/web/src/components/ui/badge.test.tsx` (a first real component test, proving the toolchain)

**Step 1: Create the setup file** — `packages/web/src/test-setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

**Step 2: Update `packages/web/vitest.config.ts`** to widen the include to `.tsx` and register the setup file (keep default `environment: "node"` — component tests opt into jsdom per-file):
```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
```

**Step 3: Write a real component test that exercises jsdom + RTL + jest-dom** — `packages/web/src/components/ui/badge.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders the default label for a kind and pairs it with a glyph (color is not the only channel)", () => {
    render(<Badge kind="deny" />);
    // text label present (second channel, not color-only)
    expect(screen.getByText("denied")).toBeInTheDocument();
  });

  it("renders custom children over the default label", () => {
    render(<Badge kind="allow">all good</Badge>);
    expect(screen.getByText("all good")).toBeInTheDocument();
  });
});
```

**Step 4: Run — verify the new component test AND the full suite pass**
```bash
cd packages/web && timeout 120 npx vitest run 2>&1 | tail -12; echo EXIT=$?
```
Expected: 17 existing + 2 new = **19 passing**.

**Step 5: Commit**
```bash
git add packages/web/src/test-setup.ts packages/web/vitest.config.ts packages/web/src/components/ui/badge.test.tsx
git commit -m "test(web): jsdom + RTL setup; first component test"
```

---

## Task 2: Pure UI helpers (formatters, filtering, health)

**Files:**
- Create: `packages/web/src/lib/dashboard.ts`
- Test: `packages/web/src/lib/dashboard.test.ts`

These pure functions hold logic the components need, so it's unit-testable in node env (no jsdom).

**Step 1: Write the failing test** — `packages/web/src/lib/dashboard.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { fmtTime, fmtLatency, uniqueValues, matchesFilters, type DecisionRow } from "./dashboard";

const row = (over: Partial<DecisionRow>): DecisionRow => ({
  id: 1, timestamp: "2026-06-09T12:00:00.000Z", agentType: "openclaw", instanceId: "i1",
  tool: "fs.write", mcpServer: "filesystem", decision: "deny", tier: "user_rule",
  ruleMatched: "no-writes", reason: "writes blocked", latencyMs: 12, resultStatus: "blocked",
  ...over,
});

describe("dashboard helpers", () => {
  it("fmtLatency renders ms or a dash", () => {
    expect(fmtLatency(12)).toBe("12ms");
    expect(fmtLatency(null)).toBe("—");
  });

  it("fmtTime returns a non-empty string and never throws on bad input", () => {
    expect(fmtTime("2026-06-09T12:00:00.000Z").length).toBeGreaterThan(0);
    expect(fmtTime("not-a-date")).toBe("not-a-date");
  });

  it("uniqueValues returns sorted distinct values for a key", () => {
    const rows = [row({ agentType: "b" }), row({ agentType: "a" }), row({ agentType: "b" })];
    expect(uniqueValues(rows, "agentType")).toEqual(["a", "b"]);
  });

  it("matchesFilters treats empty filters as match-all", () => {
    expect(matchesFilters(row({}), { agentType: "", decision: "", mcpServer: "" })).toBe(true);
  });

  it("matchesFilters ANDs the active filters", () => {
    const r = row({ agentType: "openclaw", decision: "deny", mcpServer: "filesystem" });
    expect(matchesFilters(r, { agentType: "openclaw", decision: "deny", mcpServer: "" })).toBe(true);
    expect(matchesFilters(r, { agentType: "openclaw", decision: "allow", mcpServer: "" })).toBe(false);
  });
});
```

**Step 2: Run — verify it fails** (`cannot find ./dashboard`).
```bash
cd packages/web && timeout 60 npx vitest run src/lib/dashboard.test.ts 2>&1 | tail -12; echo EXIT=$?
```

**Step 3: Implement `packages/web/src/lib/dashboard.ts`**
```ts
export interface DecisionRow {
  id: number;
  timestamp: string;
  agentType: string;
  instanceId: string;
  tool: string;
  mcpServer: string;
  decision: string;
  tier: string;
  ruleMatched: string | null;
  reason: string | null;
  latencyMs: number | null;
  resultStatus: string;
}

export interface DecisionFilters {
  agentType: string;
  decision: string;
  mcpServer: string;
}

export function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString();
  } catch {
    return iso;
  }
}

export function fmtLatency(ms: number | null): string {
  return ms !== null && ms !== undefined ? `${ms}ms` : "—";
}

export function uniqueValues<K extends keyof DecisionRow>(rows: DecisionRow[], key: K): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "string" && v) set.add(v);
  }
  return Array.from(set).sort();
}

export function matchesFilters(row: DecisionRow, f: DecisionFilters): boolean {
  if (f.agentType && row.agentType !== f.agentType) return false;
  if (f.decision && row.decision !== f.decision) return false;
  if (f.mcpServer && row.mcpServer !== f.mcpServer) return false;
  return true;
}

/** Decision → Badge kind, shared by the table and the drawer. */
export function decisionKind(decision: string): "allow" | "deny" | "warn" | "neutral" {
  if (decision === "allow") return "allow";
  if (decision === "deny") return "deny";
  if (decision === "require_approval") return "warn";
  return "neutral";
}
```

**Step 4: Run — verify pass** (5 tests).

**Step 5: Commit**
```bash
git add packages/web/src/lib/dashboard.ts packages/web/src/lib/dashboard.test.ts
git commit -m "feat(web): pure dashboard helpers (format, filter, decision kind)"
```

---

## Task 3: Left nav

**Files:**
- Create: `packages/web/src/components/shell/nav.tsx`
- Test: `packages/web/src/components/shell/nav.test.tsx`

**Step 1: Write the failing test** — `nav.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/decisions" }));

import { Nav } from "./nav";

describe("Nav", () => {
  it("marks the active route with aria-current", () => {
    render(<Nav />);
    const active = screen.getByRole("link", { name: /decisions/i });
    expect(active).toHaveAttribute("aria-current", "page");
  });

  it("renders not-yet-built items as disabled (not links)", () => {
    render(<Nav />);
    // 'Spend' is a 'soon' item — present as text but NOT a link
    expect(screen.queryByRole("link", { name: /spend/i })).toBeNull();
    expect(screen.getByText(/spend/i)).toBeInTheDocument();
  });
});
```

**Step 2: Run — verify fail.**

**Step 3: Implement `packages/web/src/components/shell/nav.tsx`**
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { label: string; href: string; soon?: boolean };
const ITEMS: Item[] = [
  { label: "Overview", href: "/" },
  { label: "Decisions", href: "/decisions" },
  { label: "Approvals", href: "/approvals" },
  { label: "Agents", href: "/agents", soon: true },
  { label: "Spend", href: "/spend", soon: true },
  { label: "Policy", href: "/policy", soon: true },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 p-3">
      <div className="px-2 pb-3 text-sm font-semibold tracking-wide">Habena</div>
      {ITEMS.map((it) => {
        if (it.soon) {
          return (
            <span
              key={it.href}
              aria-disabled="true"
              className="flex items-center justify-between rounded px-2 py-1.5 text-sm text-[var(--color-muted-foreground)] opacity-60 cursor-default"
            >
              {it.label}
              <span className="text-[10px] uppercase tracking-wide opacity-70">soon</span>
            </span>
          );
        }
        const active = pathname === it.href;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`rounded px-2 py-1.5 text-sm transition ${
              active
                ? "bg-[var(--color-surface-2)] text-[var(--color-fg)]"
                : "text-[var(--color-muted-foreground)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

**Step 4: Run — verify pass (2 tests).**

**Step 5: Commit**
```bash
git add packages/web/src/components/shell/nav.tsx packages/web/src/components/shell/nav.test.tsx
git commit -m "feat(web): left nav with active-route highlight and 'soon' items"
```

---

## Task 4: Top status bar

**Files:**
- Create: `packages/web/src/components/shell/status-bar.tsx`
- Test: `packages/web/src/components/shell/status-bar.test.tsx`

The status bar polls `/api/approvals` for the pending count and derives proxy health from `ok`. Polling uses a 2s interval; tests stub `fetch` and assert the first render after a tick.

**Step 1: Write the failing test** — `status-bar.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StatusBar } from "./status-bar";

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

function stubFetch(resp: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    json: () => Promise.resolve(resp),
    ok,
  }));
}

describe("StatusBar", () => {
  it("shows proxy 'connected' and the pending count when up", async () => {
    stubFetch({ ok: true, pending: [{ id: "a" }, { id: "b" }] });
    render(<StatusBar />);
    await waitFor(() => expect(screen.getByText(/2 pending/i)).toBeInTheDocument());
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
  });

  it("shows 'proxy not reachable' when down", async () => {
    stubFetch({ ok: false, pending: [], hint: "habena start" });
    render(<StatusBar />);
    await waitFor(() => expect(screen.getByText(/not reachable/i)).toBeInTheDocument());
  });
});
```

**Step 2: Run — verify fail.**

**Step 3: Implement `packages/web/src/components/shell/status-bar.tsx`**
```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type ApprovalsResp = { ok: boolean; pending: unknown[] };
const POLL_MS = 2000;

export function StatusBar() {
  const [up, setUp] = useState<boolean | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = (await fetch("/api/approvals", { cache: "no-store" }).then((x) => x.json())) as ApprovalsResp;
        if (cancelled) return;
        setUp(r.ok);
        setPending(Array.isArray(r.pending) ? r.pending.length : 0);
      } catch {
        if (!cancelled) setUp(false);
      }
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`inline-block h-2 w-2 rounded-full ${
            up === false ? "bg-[var(--color-deny)]" : up ? "bg-[var(--color-allow)]" : "bg-[var(--color-muted-foreground)]"
          }`}
        />
        <span className="text-[var(--color-muted-foreground)]">
          {up === false ? "Proxy not reachable" : up ? "Proxy connected" : "Checking proxy…"}
        </span>
      </div>
      <Link href="/approvals" className="text-[var(--color-muted-foreground)] hover:text-[var(--color-fg)]">
        {pending} pending
      </Link>
    </div>
  );
}
```

**Step 4: Run — verify pass (2 tests).**

**Step 5: Commit**
```bash
git add packages/web/src/components/shell/status-bar.tsx packages/web/src/components/shell/status-bar.test.tsx
git commit -m "feat(web): top status bar (proxy health + pending count)"
```

---

## Task 5: App shell + wire into layout

**Files:**
- Create: `packages/web/src/components/shell/app-shell.tsx`
- Modify: `packages/web/src/app/layout.tsx`
- Test: `packages/web/src/components/shell/app-shell.test.tsx`

**Step 1: Write the failing test** — `app-shell.test.tsx` (the command palette is added in Task 8; for now just nav + status bar + children):
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, pending: [] }) }));

import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("renders nav, status bar, and its children", () => {
    render(<AppShell><div data-testid="child">hello</div></AppShell>);
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByTestId("child")).toHaveTextContent("hello");
  });
});
```

**Step 2: Run — verify fail.**

**Step 3: Implement `packages/web/src/components/shell/app-shell.tsx`**
```tsx
"use client";
import type { ReactNode } from "react";
import { Nav } from "./nav";
import { StatusBar } from "./status-bar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-52 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)]">
        <Nav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <StatusBar />
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
```

**Step 4: Modify `packages/web/src/app/layout.tsx`** to wrap children in the shell:
```tsx
import "./globals.css";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";

export const metadata = {
  title: "Habena",
  description: "Habena local dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
```

**Step 5: Run — verify pass + full suite green + tsc.**
```bash
cd packages/web && timeout 120 npx vitest run 2>&1 | tail -10; echo EXIT=$?
timeout 120 npx tsc -p tsconfig.json --noEmit > /tmp/claude-1000/tsc.log 2>&1; echo TSC=$?; cat /tmp/claude-1000/tsc.log
```

**Step 6: Commit**
```bash
git add packages/web/src/components/shell/app-shell.tsx packages/web/src/components/shell/app-shell.test.tsx packages/web/src/app/layout.tsx
git commit -m "feat(web): app shell wrapping all pages (nav + status bar)"
```

---

## Task 6: Overview page at `/`

**Files:**
- Modify: `packages/web/src/app/page.tsx` (replace the stream with the Overview)
- Test: `packages/web/src/app/page.test.tsx`

> The existing decision-stream code in `page.tsx` is **moved** to `/decisions` in Task 7. This task replaces `/` with the Overview. To avoid losing the stream code, do Task 7's file creation first IF you prefer — but the plan order is fine because Task 7 contains the full stream code verbatim.

**Step 1: Write the failing test** — `page.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

beforeEach(() => vi.restoreAllMocks());

describe("Overview", () => {
  it("renders the summary stat cards from /api/summary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        summary: { totalDecisions: 5, allowed: 3, denied: 1, approvalPending: 1, byAgent: [], byTool: [] },
      }),
    }));
    const Overview = (await import("./page")).default;
    render(<Overview />);
    await waitFor(() => expect(screen.getByText("Allowed")).toBeInTheDocument());
    expect(screen.getByText("3")).toBeInTheDocument(); // allowed count
  });
});
```

**Step 2: Run — verify fail** (the current `page.tsx` is the stream, has no "Allowed" stat card structure matching this — it will fail until replaced).

**Step 3: Implement the Overview** — replace the ENTIRE contents of `packages/web/src/app/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";

type Summary = {
  totalDecisions: number;
  allowed: number;
  denied: number;
  approvalPending: number;
};
type SummaryResp = { ok: boolean; reason?: string; hint?: string; summary: Summary | null };

const POLL_MS = 5000;

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold" style={accent ? { color: accent } : undefined}>
        {value.toLocaleString()}
      </div>
    </Card>
  );
}

export default function Overview() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = (await fetch("/api/summary", { cache: "no-store" }).then((x) => x.json())) as SummaryResp;
        if (cancelled) return;
        setSum(r.summary);
        setHint(r.ok ? null : r.hint ?? r.reason ?? null);
      } catch (e) {
        if (!cancelled) setHint((e as Error).message);
      }
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">Your agents at a glance.</p>
      </header>

      {hint && (
        <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-muted-foreground)]">
          {hint}
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total decisions" value={sum?.totalDecisions ?? 0} />
        <Stat label="Allowed" value={sum?.allowed ?? 0} accent="var(--color-allow)" />
        <Stat label="Denied" value={sum?.denied ?? 0} accent="var(--color-deny)" />
        <Stat label="Require approval" value={sum?.approvalPending ?? 0} accent="var(--color-warn)" />
      </section>

      <p className="mt-6 text-sm text-[var(--color-muted-foreground)]">
        See the full stream in <a href="/decisions" className="underline hover:text-[var(--color-fg)]">Decisions</a>.
      </p>
    </main>
  );
}
```

**Step 4: Run — verify pass.**

**Step 5: Commit**
```bash
git add packages/web/src/app/page.tsx packages/web/src/app/page.test.tsx
git commit -m "feat(web): Overview landing page with summary stat cards"
```

---

## Task 7: Decisions page (`/decisions`) — TanStack table + filters + density + drawer

This is the largest task. Split commits per sub-piece.

**Files:**
- Create: `packages/web/src/components/decision-drawer.tsx`
- Create: `packages/web/src/components/decision-drawer.test.tsx`
- Create: `packages/web/src/app/decisions/page.tsx`
- Create: `packages/web/src/app/decisions/page.test.tsx`

### 7a — the drill-down drawer

**Step 1: Write the failing test** — `decision-drawer.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DecisionDrawer } from "./decision-drawer";
import type { DecisionRow } from "@/lib/dashboard";

const row: DecisionRow = {
  id: 1, timestamp: "2026-06-09T12:00:00.000Z", agentType: "openclaw", instanceId: "i1",
  tool: "fs.write", mcpServer: "filesystem", decision: "deny", tier: "user_rule",
  ruleMatched: "no-writes", reason: "writes are blocked by policy", latencyMs: 12, resultStatus: "blocked",
};

describe("DecisionDrawer", () => {
  it("shows the policy 'why' (tier, rule, reason) for the row", () => {
    render(<DecisionDrawer row={row} onClose={() => {}} />);
    expect(screen.getByText(/user_rule/)).toBeInTheDocument();
    expect(screen.getByText(/no-writes/)).toBeInTheDocument();
    expect(screen.getByText(/writes are blocked by policy/)).toBeInTheDocument();
  });

  it("is a modal dialog and calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<DecisionDrawer row={row} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when row is null", () => {
    const { container } = render(<DecisionDrawer row={null} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
```

**Step 2: Run — verify fail.**

**Step 3: Implement `packages/web/src/components/decision-drawer.tsx`**
```tsx
"use client";
import { useEffect, useRef } from "react";
import { Badge } from "./ui/badge";
import { fmtTime, fmtLatency, decisionKind, type DecisionRow } from "@/lib/dashboard";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--color-border)] py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-0.5 text-sm text-[var(--color-fg)] font-mono break-words">{value}</div>
    </div>
  );
}

export function DecisionDrawer({ row, onClose }: { row: DecisionRow | null; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (row) panelRef.current?.focus();
  }, [row]);
  if (!row) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Decision detail for ${row.tool}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        className="relative z-10 h-full w-full max-w-md overflow-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] p-5 focus:outline-none"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Why this decision?</h2>
          <button onClick={onClose} className="text-[var(--color-muted-foreground)] hover:text-[var(--color-fg)]" aria-label="Close">✕</button>
        </div>
        <div className="mb-3"><Badge kind={decisionKind(row.decision)}>{row.decision}</Badge></div>
        <Field label="Agent" value={`${row.agentType} · ${row.instanceId.slice(0, 8)}`} />
        <Field label="Tool" value={row.tool} />
        <Field label="Server" value={row.mcpServer} />
        <Field label="Tier" value={row.tier} />
        <Field label="Rule matched" value={row.ruleMatched ?? "—"} />
        <Field label="Reason" value={row.reason ?? "—"} />
        <Field label="Latency" value={fmtLatency(row.latencyMs)} />
        <Field label="Result" value={row.resultStatus} />
        <Field label="Time" value={fmtTime(row.timestamp)} />
      </div>
    </div>
  );
}
```

**Step 4: Run — verify pass (3 tests). Commit:**
```bash
git add packages/web/src/components/decision-drawer.tsx packages/web/src/components/decision-drawer.test.tsx
git commit -m "feat(web): accessible decision drill-down drawer (policy why)"
```

### 7b — the Decisions page (table + filters + density)

**Step 5: Write the failing test** — `decisions/page.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

beforeEach(() => vi.restoreAllMocks());

const rows = [
  { id: 1, timestamp: "2026-06-09T12:00:00.000Z", agentType: "openclaw", instanceId: "i1", tool: "fs.read", mcpServer: "filesystem", decision: "allow", tier: "default", ruleMatched: null, reason: null, latencyMs: 3, resultStatus: "ok" },
  { id: 2, timestamp: "2026-06-09T12:01:00.000Z", agentType: "hermes", instanceId: "i2", tool: "fs.write", mcpServer: "filesystem", decision: "deny", tier: "user_rule", ruleMatched: "no-writes", reason: "blocked", latencyMs: 5, resultStatus: "blocked" },
];

function stub() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, rows }) }));
}

describe("Decisions page", () => {
  it("renders a row per decision", async () => {
    stub();
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText("fs.read")).toBeInTheDocument());
    expect(screen.getByText("fs.write")).toBeInTheDocument();
  });

  it("filters by decision", async () => {
    stub();
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText("fs.read")).toBeInTheDocument());
    // select decision=deny
    fireEvent.change(screen.getByLabelText(/decision/i), { target: { value: "deny" } });
    expect(screen.queryByText("fs.read")).toBeNull();
    expect(screen.getByText("fs.write")).toBeInTheDocument();
  });

  it("opens the drawer with the policy why on row click", async () => {
    stub();
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText("fs.write")).toBeInTheDocument());
    fireEvent.click(screen.getByText("fs.write"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/no-writes/)).toBeInTheDocument();
  });
});
```

**Step 6: Run — verify fail.**

**Step 7: Implement `packages/web/src/app/decisions/page.tsx`** (TanStack table, client-side filter via `matchesFilters`, density toggle, row→drawer):
```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, flexRender,
  type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DecisionDrawer } from "@/components/decision-drawer";
import {
  fmtTime, fmtLatency, uniqueValues, matchesFilters, decisionKind,
  type DecisionRow, type DecisionFilters,
} from "@/lib/dashboard";

type Resp = { ok: boolean; reason?: string; hint?: string; rows: DecisionRow[] };
const POLL_MS = 2000;
const DECISIONS = ["allow", "deny", "require_approval"];

export default function DecisionsPage() {
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [dense, setDense] = useState(true);
  const [selected, setSelected] = useState<DecisionRow | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filters, setFilters] = useState<DecisionFilters>({ agentType: "", decision: "", mcpServer: "" });

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = (await fetch("/api/decisions?limit=200", { cache: "no-store" }).then((x) => x.json())) as Resp;
        if (cancelled) return;
        setRows(r.rows ?? []);
        setHint(r.ok ? null : r.hint ?? r.reason ?? null);
      } catch (e) {
        if (!cancelled) setHint((e as Error).message);
      }
    }
    tick();
    const t = setInterval(() => { if (!paused) tick(); }, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [paused]);

  const filtered = useMemo(() => rows.filter((r) => matchesFilters(r, filters)), [rows, filters]);
  const agents = useMemo(() => uniqueValues(rows, "agentType"), [rows]);
  const servers = useMemo(() => uniqueValues(rows, "mcpServer"), [rows]);

  const columns = useMemo<ColumnDef<DecisionRow>[]>(() => [
    { header: "Time", accessorKey: "timestamp", cell: (c) => <span className="text-[var(--color-muted-foreground)]">{fmtTime(c.getValue<string>())}</span> },
    { header: "Agent", accessorKey: "agentType", cell: (c) => <span className="font-mono">{c.getValue<string>()}</span> },
    { header: "Tool", accessorKey: "tool", cell: (c) => <span className="font-mono">{c.getValue<string>()}</span> },
    { header: "Server", accessorKey: "mcpServer", cell: (c) => <span className="font-mono text-[var(--color-muted-foreground)]">{c.getValue<string>()}</span> },
    { header: "Decision", accessorKey: "decision", cell: (c) => <Badge kind={decisionKind(c.getValue<string>())}>{c.getValue<string>()}</Badge> },
    { header: "Rule", accessorKey: "ruleMatched", cell: (c) => <span className="text-[var(--color-muted-foreground)]">{c.getValue<string>() ?? "—"}</span> },
    { header: "Latency", accessorKey: "latencyMs", cell: (c) => fmtLatency(c.getValue<number | null>()) },
  ], []);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const pad = dense ? "px-3 py-1.5" : "px-3 py-3";

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Decisions</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">{filtered.length} of {rows.length} shown</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--color-muted-foreground)]">
          <label className="flex items-center gap-1"><input type="checkbox" checked={dense} onChange={(e) => setDense(e.target.checked)} /> dense</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} /> pause</label>
        </div>
      </header>

      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        <label className="flex items-center gap-1">Agent
          <select aria-label="agent" value={filters.agentType} onChange={(e) => setFilters((f) => ({ ...f, agentType: e.target.value }))} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5">
            <option value="">all</option>{agents.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">Decision
          <select aria-label="decision" value={filters.decision} onChange={(e) => setFilters((f) => ({ ...f, decision: e.target.value }))} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5">
            <option value="">all</option>{DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">Server
          <select aria-label="server" value={filters.mcpServer} onChange={(e) => setFilters((f) => ({ ...f, mcpServer: e.target.value }))} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5">
            <option value="">all</option>{servers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      {hint && <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm text-[var(--color-muted-foreground)]">{hint}</div>}

      <div className="overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full text-xs">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} onClick={h.column.getToggleSortingHandler()}
                      className={`cursor-pointer border-b border-[var(--color-border)] text-left font-medium uppercase tracking-wide text-[var(--color-muted-foreground)] ${pad}`}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {{ asc: " ▲", desc: " ▼" }[h.column.getIsSorted() as string] ?? ""}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 && (
              <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-[var(--color-muted-foreground)]">No decisions yet — start your agent and tool calls stream here.</td></tr>
            )}
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id} onClick={() => setSelected(r.original)}
                  className="cursor-pointer border-b border-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]">
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className={`align-top ${pad}`}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DecisionDrawer row={selected} onClose={() => setSelected(null)} />
    </main>
  );
}
```

**Step 8: Run — verify pass (3 tests) + tsc.**

**Step 9: Commit**
```bash
git add packages/web/src/app/decisions
git commit -m "feat(web): Decisions stream with TanStack table, filters, density, drill-down"
```

---

## Task 8: ⌘K command palette (lowest priority — cut if it fights the toolchain)

**Files:**
- Create: `packages/web/src/components/command-palette.tsx`
- Create: `packages/web/src/components/command-palette.test.tsx`
- Modify: `packages/web/src/components/shell/app-shell.tsx` (mount the palette)

**Step 1: Write the failing test** — `command-palette.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { CommandPalette } from "./command-palette";

beforeEach(() => push.mockClear());

describe("CommandPalette", () => {
  it("opens on Cmd/Ctrl+K and navigates on selection", () => {
    render(<CommandPalette />);
    // closed initially
    expect(screen.queryByPlaceholderText(/jump to/i)).toBeNull();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByPlaceholderText(/jump to/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Decisions"));
    expect(push).toHaveBeenCalledWith("/decisions");
  });
});
```

**Step 2: Run — verify fail.**

**Step 3: Implement `packages/web/src/components/command-palette.tsx`** (uses `cmdk`):
```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";

const PAGES = [
  { label: "Overview", href: "/" },
  { label: "Decisions", href: "/decisions" },
  { label: "Approvals", href: "/approvals" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-32" role="presentation" onClick={() => setOpen(false)}>
      <Command
        label="Command palette"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
      >
        <Command.Input autoFocus placeholder="Jump to…" className="w-full bg-transparent px-4 py-3 text-sm outline-none" />
        <Command.List className="max-h-72 overflow-auto p-2">
          <Command.Empty className="px-2 py-3 text-sm text-[var(--color-muted-foreground)]">No matches.</Command.Empty>
          {PAGES.map((p) => (
            <Command.Item
              key={p.href}
              value={p.label}
              onSelect={() => { router.push(p.href); setOpen(false); }}
              className="cursor-pointer rounded px-2 py-2 text-sm aria-selected:bg-[var(--color-surface-2)]"
            >
              {p.label}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
```
> Note: `Command.Item`'s `onSelect` fires on click and on Enter. The test clicks the item text. If `cmdk`'s click handling doesn't trigger `onSelect` under jsdom, fall back to asserting the item is rendered + dispatch `keyDown Enter` on the input after typing — but try the click form first.

**Step 4: Mount in `app-shell.tsx`** — add the import and render `<CommandPalette />` inside the outer `div` (e.g. right after `<StatusBar />`'s container or at the end of the shell):
```tsx
import { CommandPalette } from "@/components/command-palette";
// ... inside AppShell return, add <CommandPalette /> as a sibling (e.g. before closing the root div)
```

**Step 5: Run — verify pass + the app-shell test still passes + tsc.**

**Step 6: Commit**
```bash
git add packages/web/src/components/command-palette.tsx packages/web/src/components/command-palette.test.tsx packages/web/src/components/shell/app-shell.tsx
git commit -m "feat(web): ⌘K command palette for page navigation"
```

---

## Task 9: Full sweep + build (controller-run)

**Step 1: Full web suite**
```bash
cd packages/web && timeout 180 npx vitest run 2>&1 | tail -25; echo EXIT=$?
```
Expected: all suites pass (17 prior lib/route + the new component tests).

**Step 2: Type-check**
```bash
timeout 120 npx tsc -p tsconfig.json --noEmit > /tmp/claude-1000/tsc.log 2>&1; echo TSC=$?; cat /tmp/claude-1000/tsc.log
```
Expected: `TSC=0`.

**Step 3: Production build** (controller runs with sandbox disabled — needs `.next` writes):
```bash
NEXT_TELEMETRY_DISABLED=1 timeout 300 npx next build 2>&1 | tail -30
```
Expected: "Compiled successfully"; route table lists `/`, `/decisions`, `/approvals` (static) and the `/api/*` (dynamic).

**Step 4: Confirm core untouched**
```bash
git diff --name-only main...HEAD | grep '^packages/core/' && echo "CORE CHANGED" || echo "core untouched ✓"
```

---

## Task 10: Manual verification recipe (user-run)

Documented in the PR; the sandbox can't run `next dev`.

```bash
habena init && habena downstream add filesystem ~/workspace && habena start   # terminal A
cd packages/web && pnpm dev                                                    # terminal B → http://localhost:7700
```

**Acceptance checklist:**
- [ ] Left nav present on every page; active item highlighted; Agents/Spend/Policy show "soon" and aren't clickable.
- [ ] Status bar shows "Proxy connected" + live pending count; stop the proxy → "Proxy not reachable".
- [ ] `/` Overview shows the four stat cards, updating as traffic flows.
- [ ] `/decisions` lists tool calls; sorting a column works; each filter (agent/decision/server) narrows the rows; the dense/pause toggles work.
- [ ] Clicking a row opens the drawer with the policy **why** (tier/rule/reason); Escape and the ✕ close it.
- [ ] ⌘K opens the palette and navigates between pages.
- [ ] Keyboard: nav links + filters + drawer + palette are reachable and show a visible focus ring; badges read by icon+text with color off.

---

## Done / handoff

When Tasks 1–9 are green and Task 10 is documented in the PR, the dashboard has a real app shell with a useful, filterable, explainable decision stream. Then use `superpowers:finishing-a-development-branch`.

**Follow-on (separate plans):** Spend page + gauges, onboarding wizard, Agents drilldown, Policy editor, threat-alerts surface, live-tail sampling/patterns-view.
