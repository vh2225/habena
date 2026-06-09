# Habena Agents Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A read-only `/agents` page listing each agent (registry ∪ observed activity), with a status classification, decision mix, top tools, and a drilldown link to its decisions.

**Architecture:** All read-only over existing files. A new `GET /api/agents` composes a server-only `agents.yaml` registry read + new per-`agent_type` aggregate queries on `audit.db`, merged by a **pure** `mergeAgents()`. The client page imports only the pure type/helpers (server readers stay out of the client bundle). Nav's "Agents" goes live; `/decisions` gains `?agent=` seeding for the drilldown.

**Tech Stack:** Next.js 16 App Router · React 19 · Tailwind v4 (existing tokens) · `yaml` (read-only) · existing `config-dir.ts` + `audit.ts` (better-sqlite3) · Vitest + jsdom + RTL. Reuses `Card`/`Badge` + `decisionKind`.

**Design doc:** `docs/plans/2026-06-09-habena-agents-page-design.md`

---

## Environment & conventions (read first)

Claude Code Bash sandbox. Per `habena-sandbox-testing-gotchas`:
- **Deps already installed.** Never run npm/pnpm install (network blocked).
- Tests: `cd packages/web && timeout 120 npx vitest run [file] 2>&1 | tail -20; echo EXIT=$?`. JSON fallback to `/tmp/claude-1000/` if output swallowed.
- tsc: `cd packages/web && timeout 120 npx tsc -p tsconfig.json --noEmit > /tmp/claude-1000/tsc.log 2>&1; echo TSC=$?; cat /tmp/claude-1000/tsc.log`
- Cannot run `next dev`/`next build` for iteration (build runs once in the sweep, controller-run, sandbox off). `/tmp` read-only → `/tmp/claude-1000/`.
- Component test files start with `// @vitest-environment jsdom`. jest-dom + RTL cleanup wired via `src/test-setup.ts`. `@/...` → `src/`.
- **CLIENT/SERVER BOUNDARY (lesson from the wizard increment):** `lib/audit.ts` (better-sqlite3) and the registry reader are SERVER-ONLY. A `"use client"` component must NEVER import them (directly or transitively) or `next build` fails bundling `better-sqlite3` for the browser — even though tests + tsc pass. Keep the client page importing ONLY pure modules (`@/lib/agents` types/helpers) + components. Server readers are imported ONLY by the route.
- Ignore untracked dotfiles. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Existing helpers:** `@/lib/config-dir` → `configDir()`; `@/lib/audit` (server-only, better-sqlite3) — you'll ADD a query here; `@/lib/dashboard` → `decisionKind(decision)`; `@/components/ui/{card,badge}`.

**Data shapes:** `agents.yaml` = `{ agents: Record<name, { name, fingerprint, registered (ISO date), mode: "enforced"|"learning"|"advisory", permissions: { budget?: { daily?, ... } } }> }`. `audit_entries` columns include `agent_type, instance_id, tool, decision, timestamp`.

---

## Task 1: pure agents module (types + mergeAgents)

**Files:** Create `packages/web/src/lib/agents.ts` + `agents.test.ts`.

This is CLIENT-SAFE (no imports). Holds the shared types + the pure merge/classification logic.

**Step 1: Write the failing test** — `agents.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mergeAgents, type RegistryAgent, type AgentActivity } from "./agents";

const reg = (over: Partial<RegistryAgent> = {}): RegistryAgent => ({
  name: "openclaw", mode: "enforced", registered: "2026-06-01", fingerprint: "oc-abc", budgetDaily: 30, ...over,
});
const act = (over: Partial<AgentActivity> = {}): AgentActivity => ({
  agentType: "openclaw", total: 5, allow: 3, deny: 1, approval: 1, topTools: [{ tool: "fs.read", count: 3 }], instancesSeen: 2, lastSeen: "2026-06-09T12:00:00.000Z", ...over,
});

describe("mergeAgents", () => {
  it("marks a registered agent with activity as 'registered'", () => {
    const [a] = mergeAgents([reg()], [act()]);
    expect(a.status).toBe("registered");
    expect(a.decisions).toEqual({ total: 5, allow: 3, deny: 1, approval: 1 });
    expect(a.budgetDaily).toBe(30);
    expect(a.mode).toBe("enforced");
  });

  it("marks a registered agent with no activity as 'idle'", () => {
    const [a] = mergeAgents([reg()], []);
    expect(a.status).toBe("idle");
    expect(a.decisions.total).toBe(0);
    expect(a.lastSeen).toBeNull();
  });

  it("marks an agent seen in audit but not registered as 'observed'", () => {
    const [a] = mergeAgents([], [act({ agentType: "rogue" })]);
    expect(a.name).toBe("rogue");
    expect(a.status).toBe("observed");
    expect(a.mode).toBeNull();
    expect(a.budgetDaily).toBeNull();
  });

  it("sorts by total decisions desc, then name", () => {
    const out = mergeAgents(
      [reg({ name: "a" }), reg({ name: "b" })],
      [act({ agentType: "a", total: 1 }), act({ agentType: "b", total: 9 })]
    );
    expect(out.map((x) => x.name)).toEqual(["b", "a"]);
  });
});
```

**Step 2: Run — verify fail.**

**Step 3: Implement `packages/web/src/lib/agents.ts`**
```ts
// CLIENT-SAFE: no node/server imports. Shared types + pure merge logic.

export interface RegistryAgent {
  name: string;
  mode: string;
  registered: string;
  fingerprint: string;
  budgetDaily: number | null;
}

export interface AgentActivity {
  agentType: string;
  total: number;
  allow: number;
  deny: number;
  approval: number;
  topTools: { tool: string; count: number }[];
  instancesSeen: number;
  lastSeen: string | null;
}

export type AgentStatus = "registered" | "idle" | "observed";

export interface AgentSummary {
  name: string;
  status: AgentStatus;
  mode: string | null;
  registered: string | null;
  fingerprint: string | null;
  budgetDaily: number | null;
  decisions: { total: number; allow: number; deny: number; approval: number };
  topTools: { tool: string; count: number }[];
  instancesSeen: number;
  lastSeen: string | null;
}

const ZERO = { total: 0, allow: 0, deny: 0, approval: 0 };

export function mergeAgents(registry: RegistryAgent[], activity: AgentActivity[]): AgentSummary[] {
  const byType = new Map(activity.map((a) => [a.agentType, a]));
  const seen = new Set<string>();
  const out: AgentSummary[] = [];

  for (const r of registry) {
    seen.add(r.name);
    const a = byType.get(r.name);
    out.push({
      name: r.name,
      status: a && a.total > 0 ? "registered" : "idle",
      mode: r.mode,
      registered: r.registered,
      fingerprint: r.fingerprint,
      budgetDaily: r.budgetDaily,
      decisions: a ? { total: a.total, allow: a.allow, deny: a.deny, approval: a.approval } : { ...ZERO },
      topTools: a?.topTools ?? [],
      instancesSeen: a?.instancesSeen ?? 0,
      lastSeen: a?.lastSeen ?? null,
    });
  }

  for (const a of activity) {
    if (seen.has(a.agentType)) continue;
    out.push({
      name: a.agentType,
      status: "observed",
      mode: null,
      registered: null,
      fingerprint: null,
      budgetDaily: null,
      decisions: { total: a.total, allow: a.allow, deny: a.deny, approval: a.approval },
      topTools: a.topTools,
      instancesSeen: a.instancesSeen,
      lastSeen: a.lastSeen,
    });
  }

  return out.sort((x, y) => y.decisions.total - x.decisions.total || x.name.localeCompare(y.name));
}
```

**Step 4: Run — verify pass (4 tests).**

**Step 5: Commit**
```bash
git add packages/web/src/lib/agents.ts packages/web/src/lib/agents.test.ts
git commit -m "feat(web): pure agents merge logic (registry + activity → summaries)"
```

---

## Task 2: audit aggregate query — `agentActivity()`

**Files:** Modify `packages/web/src/lib/audit.ts` (add a function; SERVER-ONLY — better-sqlite3).

> Not unit-tested directly (consistent with the existing `recentDecisions`/`summary` readers — covered by `next build` + the manual recipe). Open the db once, group by `agent_type`.

**Step 1: Add `agentActivity()` to `packages/web/src/lib/audit.ts`.** Import the `AgentActivity` type and reuse the existing `openReadOnly()` helper already in that file:
```ts
import type { AgentActivity } from "./agents";
```
```ts
export function agentActivity(): AgentActivity[] {
  const db = openReadOnly();
  if (!db) return [];
  try {
    const decisionRows = db
      .prepare(`SELECT agent_type, decision, COUNT(*) c FROM audit_entries GROUP BY agent_type, decision`)
      .all() as Array<{ agent_type: string; decision: string; c: number }>;
    const toolRows = db
      .prepare(`SELECT agent_type, tool, COUNT(*) c FROM audit_entries GROUP BY agent_type, tool`)
      .all() as Array<{ agent_type: string; tool: string; c: number }>;
    const instRows = db
      .prepare(`SELECT agent_type, COUNT(DISTINCT instance_id) c FROM audit_entries GROUP BY agent_type`)
      .all() as Array<{ agent_type: string; c: number }>;
    const seenRows = db
      .prepare(`SELECT agent_type, MAX(timestamp) ts FROM audit_entries GROUP BY agent_type`)
      .all() as Array<{ agent_type: string; ts: string }>;

    const map = new Map<string, AgentActivity>();
    const get = (t: string): AgentActivity => {
      let a = map.get(t);
      if (!a) {
        a = { agentType: t, total: 0, allow: 0, deny: 0, approval: 0, topTools: [], instancesSeen: 0, lastSeen: null };
        map.set(t, a);
      }
      return a;
    };

    for (const r of decisionRows) {
      const a = get(r.agent_type);
      a.total += r.c;
      if (r.decision === "allow") a.allow += r.c;
      else if (r.decision === "deny") a.deny += r.c;
      else if (r.decision === "require_approval") a.approval += r.c;
    }
    const tools = new Map<string, { tool: string; count: number }[]>();
    for (const r of toolRows) {
      const list = tools.get(r.agent_type) ?? [];
      list.push({ tool: r.tool, count: r.c });
      tools.set(r.agent_type, list);
    }
    for (const [t, list] of tools) {
      get(t).topTools = list.sort((x, y) => y.count - x.count).slice(0, 5);
    }
    for (const r of instRows) get(r.agent_type).instancesSeen = r.c;
    for (const r of seenRows) get(r.agent_type).lastSeen = r.ts ?? null;

    return Array.from(map.values());
  } finally {
    db.close();
  }
}
```
> NOTE: confirm `openReadOnly()` exists in audit.ts and is the right helper (it returns a readonly `Database | null`). If its name differs, adapt — read the file first.

**Step 2: Type-check** — `TSC=0`. (No unit test; verified by build later.)

**Step 3: Commit**
```bash
git add packages/web/src/lib/audit.ts
git commit -m "feat(web): per-agent activity aggregates from audit.db"
```

---

## Task 3: server-only registry reader

**Files:** Create `packages/web/src/lib/agents-registry.server.ts` + `agents-registry.server.test.ts`.

The PURE parse is testable; keep the file's IO thin. Mirror the `setup-status.server.ts` split: this file is SERVER-ONLY (imports node:fs + yaml + configDir) and is imported ONLY by the route.

**Step 1: Write the failing test** — `agents-registry.server.test.ts` (tests the pure `parseRegistry`, not the fs read):
```ts
import { describe, it, expect } from "vitest";
import { parseRegistry } from "./agents-registry.server";

describe("parseRegistry", () => {
  it("maps agents.yaml entries to RegistryAgent (budget from permissions.budget.daily)", () => {
    const yaml = [
      "agents:",
      "  openclaw:",
      "    name: openclaw",
      "    fingerprint: oc-abc",
      "    registered: 2026-06-01",
      "    mode: enforced",
      "    permissions:",
      "      budget:",
      "        daily: 30",
    ].join("\n");
    const out = parseRegistry(yaml);
    expect(out).toEqual([{ name: "openclaw", mode: "enforced", registered: "2026-06-01", fingerprint: "oc-abc", budgetDaily: 30 }]);
  });

  it("handles missing budget / empty file / malformed yaml without throwing", () => {
    expect(parseRegistry("agents: {}\n")).toEqual([]);
    expect(parseRegistry(null)).toEqual([]);
    expect(parseRegistry(":::bad")).toEqual([]);
    const out = parseRegistry("agents:\n  bare:\n    name: bare\n    mode: advisory\n");
    expect(out[0].budgetDaily).toBeNull();
  });
});
```

**Step 2: Run — verify fail.**

**Step 3: Implement `packages/web/src/lib/agents-registry.server.ts`**
```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { configDir } from "./config-dir";
import type { RegistryAgent } from "./agents";

interface RawAgent {
  name?: unknown;
  fingerprint?: unknown;
  registered?: unknown;
  mode?: unknown;
  permissions?: { budget?: { daily?: unknown } };
}

/** Pure: parse agents.yaml text → RegistryAgent[]. Never throws. */
export function parseRegistry(text: string | null): RegistryAgent[] {
  if (!text) return [];
  let doc: { agents?: Record<string, RawAgent> } | null = null;
  try {
    const v = parse(text);
    doc = v && typeof v === "object" ? (v as { agents?: Record<string, RawAgent> }) : null;
  } catch {
    return [];
  }
  const agents = doc?.agents;
  if (!agents || typeof agents !== "object") return [];
  return Object.entries(agents).map(([name, a]) => ({
    name: typeof a?.name === "string" ? a.name : name,
    mode: typeof a?.mode === "string" ? a.mode : "enforced",
    registered: typeof a?.registered === "string" ? a.registered : "",
    fingerprint: typeof a?.fingerprint === "string" ? a.fingerprint : "",
    budgetDaily: typeof a?.permissions?.budget?.daily === "number" ? a.permissions.budget.daily : null,
  }));
}

/** SERVER-ONLY IO: read agents.yaml from the config dir. */
export function readRegistry(): RegistryAgent[] {
  const p = join(configDir(), "agents.yaml");
  try {
    return parseRegistry(existsSync(p) ? readFileSync(p, "utf8") : null);
  } catch {
    return [];
  }
}
```

**Step 4: Run — verify pass (2 tests).**

**Step 5: Commit**
```bash
git add packages/web/src/lib/agents-registry.server.ts packages/web/src/lib/agents-registry.server.test.ts
git commit -m "feat(web): server-only agents.yaml registry reader"
```

---

## Task 4: `GET /api/agents` route

**Files:** Create `packages/web/src/app/api/agents/route.ts` + `route.test.ts`.

**Step 1: Write the failing test** — `route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/agents-registry.server", () => ({ readRegistry: vi.fn() }));
vi.mock("@/lib/audit", () => ({ agentActivity: vi.fn() }));

import { GET } from "./route";
import { readRegistry } from "@/lib/agents-registry.server";
import { agentActivity } from "@/lib/audit";

const mockReg = readRegistry as unknown as ReturnType<typeof vi.fn>;
const mockAct = agentActivity as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => vi.clearAllMocks());

describe("GET /api/agents", () => {
  it("merges registry + activity into summaries", async () => {
    mockReg.mockReturnValue([{ name: "openclaw", mode: "enforced", registered: "2026-06-01", fingerprint: "oc", budgetDaily: 30 }]);
    mockAct.mockReturnValue([{ agentType: "openclaw", total: 2, allow: 2, deny: 0, approval: 0, topTools: [], instancesSeen: 1, lastSeen: "2026-06-09T00:00:00.000Z" }]);
    const res = await GET();
    const body = await res.json();
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]).toMatchObject({ name: "openclaw", status: "registered" });
  });

  it("degrades to empty agents if a reader throws", async () => {
    mockReg.mockImplementation(() => { throw new Error("boom"); });
    mockAct.mockReturnValue([]);
    const res = await GET();
    const body = await res.json();
    expect(body.agents).toEqual([]);
  });
});
```

**Step 2: Run — verify fail.**

**Step 3: Implement `packages/web/src/app/api/agents/route.ts`**
```ts
import { NextResponse } from "next/server";
import { readRegistry } from "@/lib/agents-registry.server";
import { agentActivity } from "@/lib/audit";
import { mergeAgents } from "@/lib/agents";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json({ agents: mergeAgents(readRegistry(), agentActivity()) });
  } catch {
    return NextResponse.json({ agents: [] });
  }
}
```

**Step 4: Run — verify pass (2 tests) + tsc.**

**Step 5: Commit**
```bash
git add packages/web/src/app/api/agents
git commit -m "feat(web): GET /api/agents (registry + activity merge)"
```

---

## Task 5: `/agents` page

**Files:** Create `packages/web/src/app/agents/page.tsx` + `agents/page.test.tsx`.

Client page; imports ONLY `type AgentSummary` (pure) + `decisionKind` + `Card`/`Badge`. NO server readers.

**Step 1: Write the failing test** — `agents/page.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

beforeEach(() => vi.restoreAllMocks());

function stub(agents: unknown[]) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ agents }) }));
}

describe("Agents page", () => {
  it("renders a card per agent with its mode and decision total", async () => {
    stub([
      { name: "openclaw", status: "registered", mode: "enforced", registered: "2026-06-01", fingerprint: "oc", budgetDaily: 30, decisions: { total: 5, allow: 3, deny: 1, approval: 1 }, topTools: [{ tool: "fs.read", count: 3 }], instancesSeen: 2, lastSeen: "2026-06-09T12:00:00.000Z" },
    ]);
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText("openclaw")).toBeInTheDocument());
    expect(screen.getByText(/enforced/i)).toBeInTheDocument();
    expect(screen.getByText(/Daily budget: \$30/)).toBeInTheDocument();
  });

  it("flags an observed-but-unregistered agent", async () => {
    stub([
      { name: "rogue", status: "observed", mode: null, registered: null, fingerprint: null, budgetDaily: null, decisions: { total: 2, allow: 0, deny: 2, approval: 0 }, topTools: [], instancesSeen: 1, lastSeen: "2026-06-09T12:00:00.000Z" },
    ]);
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText("rogue")).toBeInTheDocument());
    expect(screen.getByText(/unregistered/i)).toBeInTheDocument();
  });

  it("shows a teaching empty state when there are no agents", async () => {
    stub([]);
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/no agents yet/i)).toBeInTheDocument());
  });
});
```

**Step 2: Run — verify fail.**

**Step 3: Implement `packages/web/src/app/agents/page.tsx`**
```tsx
"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtTime } from "@/lib/dashboard";
import type { AgentSummary } from "@/lib/agents";

const POLL_MS = 5000;

type Resp = { agents: AgentSummary[] };

function StatusChip({ status }: { status: AgentSummary["status"] }) {
  if (status === "observed") return <Badge kind="warn">observed · unregistered</Badge>;
  if (status === "idle") return <Badge kind="neutral">idle</Badge>;
  return <Badge kind="allow">registered</Badge>;
}

function AgentCard({ a }: { a: AgentSummary }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm text-[var(--color-fg)]">{a.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
            <StatusChip status={a.status} />
            {a.mode && <span>mode: {a.mode}</span>}
            {a.registered && <span>· registered {a.registered}</span>}
            {a.lastSeen && <span>· last seen {fmtTime(a.lastSeen)}</span>}
          </div>
        </div>
        <a href={`/decisions?agent=${encodeURIComponent(a.name)}`} className="shrink-0 text-xs text-[var(--color-muted-foreground)] underline hover:text-[var(--color-fg)]">
          View decisions →
        </a>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <Badge kind="allow">{a.decisions.allow} allowed</Badge>
        <Badge kind="deny">{a.decisions.deny} denied</Badge>
        <Badge kind="warn">{a.decisions.approval} approval</Badge>
        <span className="text-[var(--color-muted-foreground)]">· {a.instancesSeen} instance{a.instancesSeen === 1 ? "" : "s"} seen</span>
      </div>

      {a.topTools.length > 0 && (
        <div className="mt-2 text-xs text-[var(--color-muted-foreground)]">
          top tools: {a.topTools.map((t) => `${t.tool} (${t.count})`).join(" · ")}
        </div>
      )}

      {a.budgetDaily !== null && (
        <div className="mt-2 text-xs text-[var(--color-muted-foreground)]">Daily budget: ${a.budgetDaily}</div>
      )}
    </Card>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = (await fetch("/api/agents", { cache: "no-store" }).then((x) => x.json())) as Resp;
        if (cancelled) return;
        setAgents(Array.isArray(r.agents) ? r.agents : []);
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Agents</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">Registered agents and what they&apos;ve been doing.</p>
      </header>

      {loaded && agents.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          No agents yet — register one with <code>habena agent add --name &lt;name&gt; --budget-daily &lt;n&gt;</code>, or finish setup in <a href="/welcome" className="underline">the wizard</a>.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {agents.map((a) => <AgentCard key={a.name} a={a} />)}
      </div>
    </main>
  );
}
```

**Step 4: Run — verify pass (3 tests) + tsc.**

**Step 5: Commit**
```bash
git add packages/web/src/app/agents
git commit -m "feat(web): /agents page (cards: status, decision mix, top tools, budget)"
```

---

## Task 6: activate the "Agents" nav item

**Files:** Modify `packages/web/src/components/shell/nav.tsx` + `nav.test.tsx`.

**Step 1: Add a failing test** to `nav.test.tsx` (keep existing tests):
```tsx
  it("renders Agents as a live link (no longer 'soon')", () => {
    render(<Nav />);
    expect(screen.getByRole("link", { name: /agents/i })).toHaveAttribute("href", "/agents");
  });
```
(The existing test mocks `usePathname` → "/decisions"; keep it. Spend/Policy stay "soon".)

**Step 2: Run — verify the new test fails** (Agents is currently a `soon` span, not a link).

**Step 3: Modify `nav.tsx`** — in the `ITEMS` array, change the Agents entry from `{ label: "Agents", href: "/agents", soon: true }` to `{ label: "Agents", href: "/agents" }`. Leave Spend + Policy as `soon: true`.

**Step 4: Run — verify pass + full suite + tsc.**

**Step 5: Commit**
```bash
git add packages/web/src/components/shell/nav.tsx packages/web/src/components/shell/nav.test.tsx
git commit -m "feat(web): activate Agents nav item"
```

---

## Task 7: `/decisions` `?agent=` filter seeding

**Files:** Modify `packages/web/src/app/decisions/page.tsx` + `decisions/page.test.tsx`.

Seed the agent filter from the URL on mount via `window.location.search` (NOT `useSearchParams` — avoids Next's Suspense/prerender constraint and keeps `/decisions` statically shelled).

**Step 1: Add a failing test** to `decisions/page.test.tsx` (keep existing tests; the `rows`/`stub` helpers exist):
```tsx
  it("seeds the agent filter from ?agent= in the URL", async () => {
    stub();
    window.history.replaceState({}, "", "/decisions?agent=hermes");
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText("fs.write")).toBeInTheDocument()); // hermes row
    expect(screen.queryByText("fs.read")).toBeNull(); // openclaw row filtered out
    // reset for other tests
    window.history.replaceState({}, "", "/");
  });
```
> The existing `rows` fixture has openclaw→fs.read (allow) and hermes→fs.write (deny). Seeding agent=hermes should hide fs.read and keep fs.write.

**Step 2: Run — verify fail.**

**Step 3: Modify `decisions/page.tsx`** — add an effect that reads the `agent` query param once on mount and seeds the filter. After the existing `useState` for `filters`, add:
```tsx
  useEffect(() => {
    const agent = new URLSearchParams(window.location.search).get("agent");
    if (agent) setFilters((f) => ({ ...f, agentType: agent }));
  }, []);
```
(Place it near the other effects. `useEffect` is already imported. This runs client-side after mount; it doesn't affect the static shell. The filter `<select>` will show the seeded agent even if it's not in the current `agents` option list — that's fine; `matchesFilters` still filters correctly. Optionally the seeded value appears as the select's value; acceptable.)

**Step 4: Run — verify pass + full suite + tsc.**

**Step 5: Commit**
```bash
git add packages/web/src/app/decisions/page.tsx packages/web/src/app/decisions/page.test.tsx
git commit -m "feat(web): seed /decisions agent filter from ?agent= query param"
```

---

## Task 8: Full sweep + build (controller-run)

**Step 1:** `cd packages/web && timeout 180 npx vitest run 2>&1 | tail -25; echo EXIT=$?` — all pass.
**Step 2:** `timeout 120 npx tsc -p tsconfig.json --noEmit > /tmp/claude-1000/tsc.log 2>&1; echo TSC=$?; cat /tmp/claude-1000/tsc.log` — `TSC=0`.
**Step 3 (sandbox off):** `NEXT_TELEMETRY_DISABLED=1 timeout 300 npx next build 2>&1 | tail -30` — "Compiled successfully"; routes include `/agents` (static) + `/api/agents` (dynamic). **Critically: confirm NO "Can't resolve 'fs'/better-sqlite3" client-bundle error** (the agents page must not transitively import the server readers).
**Step 4:** `git diff --name-only main...HEAD | grep '^packages/core/' && echo "CORE CHANGED" || echo "core untouched ✓"`.

---

## Task 9: Manual verification recipe (user-run)

```bash
habena init && habena agent add --name openclaw --budget-daily 30 && habena start
cd packages/web && pnpm dev    # http://localhost:7700/agents
# trigger some tool calls through the proxy, then watch /agents
```
**Acceptance checklist:**
- [ ] `/agents` reachable from the nav (Agents no longer "soon").
- [ ] A registered agent shows mode, registered date, daily budget (as config, not a gauge), decision mix, top tools, instances-seen, last-seen.
- [ ] A registered agent with no traffic shows "idle"; an agent seen in the audit log but not registered shows "observed · unregistered".
- [ ] "View decisions →" opens `/decisions` pre-filtered to that agent.
- [ ] Empty state shows when no agents.
- [ ] Keyboard: cards' links reachable with a visible focus ring; status/decision badges read by icon+text with color off.

---

## Done / handoff

When Tasks 1–8 are green and Task 9 is documented in the PR, the dashboard has an Agents view. Then use `superpowers:finishing-a-development-branch`.

**Follow-on (separate plans):** per-agent detail route `/agents/[name]`; Policy *viewer*; threat-alerts (needs Workstream B); real spend (needs cost attribution).
