# Habena Policy Viewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A read-only `/policy` page that renders the policy configuration from `config.yaml` — budget, ordered rules (action + enforcement badges), inherited packs, approval, downstreams — labeled honestly as config (not the fully-resolved effective policy).

**Architecture:** Read-only over a new `GET /api/policy` that reads `config.yaml` via a server-only `parsePolicy`/`readPolicy`. The client page imports only pure types + an `actionKind` helper (server reader stays out of the client bundle). Nav's "Policy" goes live. **Tokens/secrets are never included in the response** (channels are listed by name only).

**Tech Stack:** Next.js 16 App Router · React 19 · Tailwind v4 (existing tokens) · `yaml` (read-only) · existing `config-dir.ts` · Vitest + jsdom + RTL. Reuses `Card`/`Badge`.

**Design doc:** `docs/plans/2026-06-09-habena-policy-viewer-design.md`

---

## Environment & conventions (read first)

Claude Code Bash sandbox. Per `habena-sandbox-testing-gotchas`:
- **Deps installed.** Never run npm/pnpm install (network blocked).
- Tests: `cd packages/web && timeout 120 npx vitest run [file] 2>&1 | tail -20; echo EXIT=$?` (JSON fallback to `/tmp/claude-1000/`).
- tsc: `cd packages/web && timeout 120 npx tsc -p tsconfig.json --noEmit > /tmp/claude-1000/tsc.log 2>&1; echo TSC=$?; cat /tmp/claude-1000/tsc.log`
- Cannot run `next dev`/`next build` for iteration (build runs once in the sweep, controller-run, sandbox off). `/tmp` read-only → `/tmp/claude-1000/`.
- Component test files start with `// @vitest-environment jsdom`. jest-dom + RTL cleanup wired via `src/test-setup.ts`. `@/...` → `src/`.
- **CLIENT/SERVER BOUNDARY (recurring lesson):** the policy SERVER reader (`lib/policy.server.ts`, imports `node:fs`+`yaml`) must be imported ONLY by the route. The `"use client"` `/policy` page imports ONLY the pure `lib/policy.ts` (import-free) + UI primitives — never the `.server` module — or `next build` fails bundling node code for the browser (tests+tsc won't catch it; the sweep's `next build` will).
- Ignore untracked dotfiles. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Existing helper:** `@/lib/config-dir` → `configDir()`. **Config shape** (`config.yaml`): `budget {daily,monthly,per_session,per_request,alert_at,on_exceed}`; `rules[] {match{tool,server,args_contain,command_matches}, action, enforcement, reason}`; `extends: string[]`; `approval {timeout_action, require_for{tools,tool_tags}, channels{telegram{...}}}`; `mcp_servers {<name>{command,...}}`.

---

## Task 1: pure policy module (types + actionKind)

**Files:** Create `packages/web/src/lib/policy.ts` + `policy.test.ts`. CLIENT-SAFE (no imports).

**Step 1: Write the failing test** — `policy.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { actionKind } from "./policy";

describe("actionKind", () => {
  it("maps policy actions to badge kinds", () => {
    expect(actionKind("allow")).toBe("allow");
    expect(actionKind("deny")).toBe("deny");
    expect(actionKind("deny_if")).toBe("deny");
    expect(actionKind("deny_unless")).toBe("deny");
    expect(actionKind("require_approval")).toBe("warn");
    expect(actionKind("anything-else")).toBe("neutral");
  });
});
```

**Step 2: Run — verify fail.**

**Step 3: Implement `packages/web/src/lib/policy.ts`**
```ts
// CLIENT-SAFE: no node/server imports. Shared types + pure helper.

export interface RuleView {
  index: number;
  match: Record<string, unknown>;
  action: string;
  enforcement: string | null;
  reason: string | null;
}
export interface BudgetView {
  daily: number | null;
  monthly: number | null;
  perSession: number | null;
  perRequest: number | null;
  onExceed: string | null;
  alertAt: number[] | null;
}
export interface ApprovalView {
  timeoutAction: string | null;
  alwaysRequire: string[];
  channels: string[]; // channel NAMES only — never tokens
}
export interface DownstreamView {
  name: string;
  command: string | null;
}
export interface PolicyView {
  configured: boolean;
  budget: BudgetView | null;
  rules: RuleView[];
  extendsPacks: string[];
  approval: ApprovalView | null;
  downstreams: DownstreamView[];
}

export function actionKind(action: string): "allow" | "deny" | "warn" | "neutral" {
  if (action === "allow") return "allow";
  if (action === "deny" || action === "deny_if" || action === "deny_unless") return "deny";
  if (action === "require_approval") return "warn";
  return "neutral";
}
```

**Step 4: Run — verify pass.**

**Step 5: Commit**
```bash
git add packages/web/src/lib/policy.ts packages/web/src/lib/policy.test.ts
git commit -m "feat(web): pure policy view types + actionKind helper"
```

---

## Task 2: server-only policy reader (parsePolicy + readPolicy)

**Files:** Create `packages/web/src/lib/policy.server.ts` + `policy.server.test.ts`. SERVER-ONLY (node:fs + yaml). `parsePolicy` is the pure, tested core.

**Step 1: Write the failing test** — `policy.server.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parsePolicy } from "./policy.server";

describe("parsePolicy", () => {
  it("returns not-configured for null/malformed yaml (never throws)", () => {
    expect(parsePolicy(null).configured).toBe(false);
    expect(parsePolicy(":::bad").configured).toBe(false);
  });

  it("extracts budget, ordered rules, extends, approval (names only), downstreams", () => {
    const text = [
      "budget:",
      "  daily: 50",
      "  on_exceed: deny",
      "rules:",
      "  - match: { tool: read_file }",
      "    action: allow",
      "    reason: pack:fs",
      "  - match: { tool: write_file }",
      "    action: require_approval",
      "    enforcement: hard_mandatory",
      "extends: [filesystem-readonly]",
      "approval:",
      "  timeout_action: deny",
      "  require_for: { tools: [shell_execute], tool_tags: [destructive] }",
      "  channels:",
      "    telegram:",
      "      token: SUPERSECRET",
      "      owner_id: 1",
      "mcp_servers:",
      "  filesystem:",
      "    command: npx",
    ].join("\n");
    const p = parsePolicy(text);
    expect(p.configured).toBe(true);
    expect(p.budget).toMatchObject({ daily: 50, onExceed: "deny" });
    expect(p.rules.map((r) => r.action)).toEqual(["allow", "require_approval"]);
    expect(p.rules[0].index).toBe(0);
    expect(p.rules[1].enforcement).toBe("hard_mandatory");
    expect(p.extendsPacks).toEqual(["filesystem-readonly"]);
    expect(p.approval).toMatchObject({ timeoutAction: "deny" });
    expect(p.approval?.alwaysRequire).toEqual(["shell_execute", "destructive"]);
    expect(p.approval?.channels).toEqual(["telegram"]);
    expect(p.downstreams).toEqual([{ name: "filesystem", command: "npx" }]);
    // SECRET HYGIENE: the token must never appear anywhere in the view
    expect(JSON.stringify(p)).not.toContain("SUPERSECRET");
  });

  it("handles a partial config (missing sections) without throwing", () => {
    const p = parsePolicy("budget: {}\n");
    expect(p.configured).toBe(true);
    expect(p.rules).toEqual([]);
    expect(p.approval).toBeNull();
    expect(p.downstreams).toEqual([]);
  });
});
```

**Step 2: Run — verify fail.**

**Step 3: Implement `packages/web/src/lib/policy.server.ts`**
```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { configDir } from "./config-dir";
import type { PolicyView, RuleView, BudgetView, ApprovalView, DownstreamView } from "./policy";

function emptyView(): PolicyView {
  return { configured: false, budget: null, rules: [], extendsPacks: [], approval: null, downstreams: [] };
}
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Pure: parse config.yaml text → PolicyView. Never throws. Never includes secrets. */
export function parsePolicy(text: string | null): PolicyView {
  if (!text) return emptyView();
  let doc: Record<string, unknown> | null = null;
  try {
    const v = parse(text);
    doc = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return emptyView();
  }
  if (!doc) return emptyView();

  const b = doc.budget as Record<string, unknown> | undefined;
  const budget: BudgetView | null = b && typeof b === "object"
    ? {
        daily: num(b.daily), monthly: num(b.monthly), perSession: num(b.per_session), perRequest: num(b.per_request),
        onExceed: str(b.on_exceed), alertAt: Array.isArray(b.alert_at) ? (b.alert_at.filter((x): x is number => typeof x === "number")) : null,
      }
    : null;

  const rawRules = Array.isArray(doc.rules) ? doc.rules : [];
  const rules: RuleView[] = rawRules.map((r, i) => {
    const rule = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    return {
      index: i,
      match: (rule.match && typeof rule.match === "object" ? rule.match : {}) as Record<string, unknown>,
      action: str(rule.action) ?? "",
      enforcement: str(rule.enforcement),
      reason: str(rule.reason),
    };
  });

  const extendsPacks = strArr(doc.extends);

  const ap = doc.approval as Record<string, unknown> | undefined;
  let approval: ApprovalView | null = null;
  if (ap && typeof ap === "object") {
    const rf = ap.require_for as { tools?: unknown; tool_tags?: unknown } | undefined;
    const alwaysRequire = [...strArr(rf?.tools), ...strArr(rf?.tool_tags)];
    const channels = ap.channels && typeof ap.channels === "object" ? Object.keys(ap.channels as Record<string, unknown>) : [];
    approval = { timeoutAction: str(ap.timeout_action), alwaysRequire, channels };
  }

  const ms = doc.mcp_servers as Record<string, unknown> | undefined;
  const downstreams: DownstreamView[] = ms && typeof ms === "object"
    ? Object.entries(ms).map(([name, v]) => ({ name, command: str((v as Record<string, unknown> | null)?.command) }))
    : [];

  return { configured: true, budget, rules, extendsPacks, approval, downstreams };
}

/** SERVER-ONLY IO: read config.yaml from the config dir. */
export function readPolicy(): PolicyView {
  const p = join(configDir(), "config.yaml");
  try {
    return parsePolicy(existsSync(p) ? readFileSync(p, "utf8") : null);
  } catch {
    return emptyView();
  }
}
```
> Note: `approval.channels` is reduced to `Object.keys(...)` (names only). The token-hygiene test asserts no secret leaks — keep it that way.

**Step 4: Run — verify pass (3 tests) + tsc.**

**Step 5: Commit**
```bash
git add packages/web/src/lib/policy.server.ts packages/web/src/lib/policy.server.test.ts
git commit -m "feat(web): server-only policy reader (config.yaml → PolicyView, no secrets)"
```

---

## Task 3: `GET /api/policy` route

**Files:** Create `packages/web/src/app/api/policy/route.ts` + `route.test.ts`.

**Step 1: Write the failing test** — `route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/policy.server", () => ({ readPolicy: vi.fn() }));

import { GET } from "./route";
import { readPolicy } from "@/lib/policy.server";

const mockRead = readPolicy as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => vi.clearAllMocks());

describe("GET /api/policy", () => {
  it("returns the policy view", async () => {
    mockRead.mockReturnValue({ configured: true, budget: { daily: 50, monthly: null, perSession: null, perRequest: null, onExceed: "deny", alertAt: null }, rules: [], extendsPacks: [], approval: null, downstreams: [] });
    const res = await GET();
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.budget.daily).toBe(50);
  });

  it("degrades to a not-configured view if the reader throws", async () => {
    mockRead.mockImplementation(() => { throw new Error("boom"); });
    const res = await GET();
    const body = await res.json();
    expect(body.configured).toBe(false);
    expect(body.rules).toEqual([]);
  });
});
```

**Step 2: Run — verify fail.**

**Step 3: Implement `packages/web/src/app/api/policy/route.ts`**
```ts
import { NextResponse } from "next/server";
import { readPolicy } from "@/lib/policy.server";
import type { PolicyView } from "@/lib/policy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EMPTY: PolicyView = { configured: false, budget: null, rules: [], extendsPacks: [], approval: null, downstreams: [] };

export async function GET() {
  try {
    return NextResponse.json(readPolicy());
  } catch {
    return NextResponse.json(EMPTY);
  }
}
```

**Step 4: Run — verify pass (2 tests) + tsc.**

**Step 5: Commit**
```bash
git add packages/web/src/app/api/policy
git commit -m "feat(web): GET /api/policy (read-only config.yaml view)"
```

---

## Task 4: `/policy` page

**Files:** Create `packages/web/src/app/policy/page.tsx` + `policy/page.test.tsx`. Client; imports ONLY `actionKind` + `type PolicyView` from `@/lib/policy` + `Card`/`Badge`.

**Step 1: Write the failing test** — `policy/page.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

beforeEach(() => vi.restoreAllMocks());
function stub(view: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(view) }));
}

describe("Policy page", () => {
  it("renders budget + a rule row with action and enforcement badges", async () => {
    stub({
      configured: true,
      budget: { daily: 50, monthly: null, perSession: null, perRequest: null, onExceed: "deny", alertAt: null },
      rules: [{ index: 0, match: { tool: "write_file" }, action: "require_approval", enforcement: "hard_mandatory", reason: "writes" }],
      extendsPacks: ["filesystem-readonly"],
      approval: { timeoutAction: "deny", alwaysRequire: ["shell_execute"], channels: ["telegram"] },
      downstreams: [{ name: "filesystem", command: "npx" }],
    });
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/require_approval/)).toBeInTheDocument());
    expect(screen.getByText(/hard_mandatory/)).toBeInTheDocument();
    expect(screen.getByText(/filesystem-readonly/)).toBeInTheDocument();
    expect(screen.getByText(/\$50/)).toBeInTheDocument();
  });

  it("shows a teaching empty state when not configured", async () => {
    stub({ configured: false, budget: null, rules: [], extendsPacks: [], approval: null, downstreams: [] });
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/no policy yet/i)).toBeInTheDocument());
  });
});
```

**Step 2: Run — verify fail.**

**Step 3: Implement `packages/web/src/app/policy/page.tsx`**
```tsx
"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { actionKind, type PolicyView } from "@/lib/policy";

const POLL_MS = 5000;
const EMPTY: PolicyView = { configured: false, budget: null, rules: [], extendsPacks: [], approval: null, downstreams: [] };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

export default function PolicyPage() {
  const [p, setP] = useState<PolicyView>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = (await fetch("/api/policy", { cache: "no-store" }).then((x) => x.json())) as PolicyView;
        if (cancelled) return;
        setP(r);
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
        <h1 className="text-xl font-semibold">Policy</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Your policy configuration — what&apos;s in <code>config.yaml</code>. Inherited rule packs add more rules at runtime.
        </p>
      </header>

      {loaded && !p.configured && (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          No policy yet — run <code>habena init</code> or finish setup in <a href="/welcome" className="underline">the wizard</a>.
        </div>
      )}

      {p.configured && (
        <div className="flex flex-col gap-3">
          {p.budget && (
            <Section title="Budget">
              <div className="grid grid-cols-2 gap-2 text-xs text-[var(--color-muted-foreground)] sm:grid-cols-3">
                {p.budget.daily !== null && <div>daily: <span className="text-[var(--color-fg)]">${p.budget.daily}</span></div>}
                {p.budget.monthly !== null && <div>monthly: <span className="text-[var(--color-fg)]">${p.budget.monthly}</span></div>}
                {p.budget.perSession !== null && <div>per session: <span className="text-[var(--color-fg)]">${p.budget.perSession}</span></div>}
                {p.budget.perRequest !== null && <div>per request: <span className="text-[var(--color-fg)]">${p.budget.perRequest}</span></div>}
                {p.budget.onExceed && <div>on exceed: <span className="text-[var(--color-fg)]">{p.budget.onExceed}</span></div>}
              </div>
            </Section>
          )}

          <Section title={`Rules (${p.rules.length}) — first match wins`}>
            {p.rules.length === 0 ? (
              <div className="text-xs text-[var(--color-muted-foreground)]">No inline rules.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {p.rules.map((r) => (
                  <div key={r.index} className="flex flex-wrap items-center gap-2 border-b border-[var(--color-surface-2)] pb-2 text-xs">
                    <span className="w-5 shrink-0 text-[var(--color-muted-foreground)]">{r.index + 1}.</span>
                    <Badge kind={actionKind(r.action)}>{r.action || "—"}</Badge>
                    {r.enforcement && <Badge kind="neutral">{r.enforcement}</Badge>}
                    <code className="text-[var(--color-fg)]">{JSON.stringify(r.match)}</code>
                    {r.reason && <span className="text-[var(--color-muted-foreground)]">— {r.reason}</span>}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {p.extendsPacks.length > 0 && (
            <Section title="Inherited rule packs">
              <div className="flex flex-wrap gap-2 text-xs">
                {p.extendsPacks.map((name) => <Badge key={name} kind="neutral">{name}</Badge>)}
              </div>
              <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">These packs add built-in rules resolved at runtime (not shown here).</p>
            </Section>
          )}

          {p.approval && (
            <Section title="Approval">
              <div className="flex flex-col gap-1 text-xs text-[var(--color-muted-foreground)]">
                {p.approval.timeoutAction && <div>on timeout: <span className="text-[var(--color-fg)]">{p.approval.timeoutAction}</span></div>}
                {p.approval.alwaysRequire.length > 0 && <div>always require approval: <span className="text-[var(--color-fg)]">{p.approval.alwaysRequire.join(", ")}</span></div>}
                <div>channels: <span className="text-[var(--color-fg)]">{p.approval.channels.length > 0 ? p.approval.channels.join(", ") : "none"}</span></div>
              </div>
            </Section>
          )}

          {p.downstreams.length > 0 && (
            <Section title="Downstreams">
              <div className="flex flex-col gap-1 text-xs text-[var(--color-muted-foreground)]">
                {p.downstreams.map((d) => (
                  <div key={d.name}>
                    <span className="font-mono text-[var(--color-fg)]">{d.name}</span>
                    {d.command && <span> · {d.command}</span>}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </main>
  );
}
```

**Step 4: Run — verify pass (2 tests) + tsc.**

**Step 5: Commit**
```bash
git add packages/web/src/app/policy
git commit -m "feat(web): /policy page (read-only config render: budget, rules, approval)"
```

---

## Task 5: activate the "Policy" nav item

**Files:** Modify `packages/web/src/components/shell/nav.tsx` + `nav.test.tsx`.

**Step 1: Add a failing test** to `nav.test.tsx` (keep existing tests):
```tsx
  it("renders Policy as a live link (no longer 'soon')", () => {
    render(<Nav />);
    expect(screen.getByRole("link", { name: /policy/i })).toHaveAttribute("href", "/policy");
  });
```

**Step 2: Run — verify fail** (Policy is currently a `soon` span).

**Step 3: Modify `nav.tsx`** — change the `ITEMS` entry `{ label: "Policy", href: "/policy", soon: true }` to `{ label: "Policy", href: "/policy" }`. Leave **Spend** as the only remaining `soon: true` item.

**Step 4: Run — verify pass + full suite + tsc.**

**Step 5: Commit**
```bash
git add packages/web/src/components/shell/nav.tsx packages/web/src/components/shell/nav.test.tsx
git commit -m "feat(web): activate Policy nav item"
```

---

## Task 6: Full sweep + build (controller-run)

**Step 1:** `cd packages/web && timeout 180 npx vitest run 2>&1 | tail -25; echo EXIT=$?` — all pass.
**Step 2:** `timeout 120 npx tsc -p tsconfig.json --noEmit > /tmp/claude-1000/tsc.log 2>&1; echo TSC=$?; cat /tmp/claude-1000/tsc.log` — `TSC=0`.
**Step 3 (sandbox off):** `NEXT_TELEMETRY_DISABLED=1 timeout 300 npx next build 2>&1 | tail -30` — "Compiled successfully"; routes include `/policy` (static) + `/api/policy` (dynamic). **Confirm NO "Can't resolve 'fs'/better-sqlite3" client-bundle error** (the `/policy` page must not import the server reader).
**Step 4:** `git diff --name-only main...HEAD | grep '^packages/core/' && echo "CORE CHANGED" || echo "core untouched ✓"`.

---

## Task 7: Manual verification recipe (user-run)

```bash
habena init && cd packages/web && pnpm dev   # http://localhost:7700/policy
```
**Acceptance checklist:**
- [ ] `/policy` reachable from the nav (Policy no longer "soon").
- [ ] Budget section shows the init defaults (daily/monthly/per-session/per-request, on-exceed).
- [ ] Rules listed in order with an action badge (allow=green, require_approval=amber, deny=red) + enforcement badge + the match + reason.
- [ ] After `habena downstream add filesystem ~/ws`, the downstream appears.
- [ ] After configuring Telegram, Approval → channels shows "telegram" — **the token never appears anywhere on the page** (view it / inspect `/api/policy`).
- [ ] Empty state shows before `habena init`.
- [ ] Keyboard: links reachable with a visible focus ring; action/enforcement badges read by icon+text with color off.

---

## Done / handoff

When Tasks 1–6 are green and Task 7 is documented in the PR, the dashboard has a Policy viewer. Then use `superpowers:finishing-a-development-branch`.

**Follow-on (separate plans):** resolve/expand `extends` rule packs (cross-package read); a policy *simulator* ("what happens for tool X"); per-agent detail route; real Spend (cost attribution); threat-alerts (Workstream B). Editing policy stays out (read-only boundary).
