# Habena Onboarding Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A first-run onboarding wizard at `/welcome` that guides a user from nothing to a working guarded agent — collecting their choices, showing the exact CLI commands, and live-detecting each step's completion — ending on the "trigger a call → watch it land" aha.

**Architecture:** All client-side over a single NEW **read-only** endpoint `GET /api/setup-status` (which inspects the config dir: `config.yaml`/`agents.yaml` via the `yaml` lib, the proxy socket, and the audit row count). The wizard polls it every ~2s and auto-advances. **No config writes, no process spawning, no core changes** — the CLI stays the source of truth; the wizard watches and teaches.

**Tech Stack:** Next.js 16 App Router (route handler in Node runtime) · React 19 · Tailwind v4 (existing tokens) · `yaml` (read-only parse) · existing `config-dir.ts` + `proxyRunning()` + audit reader · Vitest + jsdom + RTL. Reuses `Card`/`Button` primitives.

**Design doc:** `docs/plans/2026-06-09-habena-onboarding-wizard-design.md`

---

## Environment & conventions (read first)

Claude Code Bash sandbox. Per `habena-sandbox-testing-gotchas`:
- **Deps already installed & committed** (`yaml` added). **Never run npm/pnpm install** (network blocked).
- Tests: `cd packages/web && timeout 120 npx vitest run [file] 2>&1 | tail -20; echo EXIT=$?`. If output swallowed, add `--reporter=json --outputFile=/tmp/claude-1000/r.json` and read it.
- tsc (redirect for a trustworthy exit code): `cd packages/web && timeout 120 npx tsc -p tsconfig.json --noEmit > /tmp/claude-1000/tsc.log 2>&1; echo TSC=$?; cat /tmp/claude-1000/tsc.log`
- Cannot run `next dev`/`next build` for iteration (build runs once in the final sweep, controller-run with sandbox off). `/tmp` read-only → use `/tmp/claude-1000/`.
- Component test files start with `// @vitest-environment jsdom`. `next/navigation` must be mocked in tests. jest-dom matchers + RTL auto-cleanup are wired via `src/test-setup.ts`. `@/...` → `src/`.
- Ignore untracked dotfiles. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Existing helpers to reuse (do not reimplement):**
- `@/lib/config-dir` → `configDir()` (resolves `~/.habena` etc.).
- `@/lib/approval-ipc` → `proxyRunning(): boolean` (socket-exists check).
- `@/lib/audit` → `summary(): { totalDecisions, ... }` (returns 0s if no db) and `dbExists()`.

**Config shapes the status reader inspects (from core):**
- `config.yaml`: top-level `mcp_servers: Record<name, {...}>` and `approval.channels.telegram`.
- `agents.yaml`: top-level `agents: Record<name, {...}>` (`{}` when none).

---

## Task 1: setup-status lib (pure parse + IO reader + command builders)

**Files:**
- Create: `packages/web/src/lib/setup-status.ts`
- Test: `packages/web/src/lib/setup-status.test.ts`

The PURE pieces (`parseSetupStatus`, the command builders) are unit-tested in node env. The IO `readSetupStatus()` is thin and covered by the route test (mocked) + the manual recipe.

**Step 1: Write the failing test** — `setup-status.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseSetupStatus, downstreamAddCommand, agentAddCommand } from "./setup-status";

describe("parseSetupStatus", () => {
  it("reports not-configured when config is absent", () => {
    const s = parseSetupStatus({ configExists: false, configText: null, agentsText: null, proxyRunning: false, decisionCount: 0 });
    expect(s).toEqual({ configExists: false, downstreams: [], agents: [], telegramConfigured: false, proxyRunning: false, decisionCount: 0 });
  });

  it("extracts downstream + telegram from config.yaml and agents from agents.yaml", () => {
    const configText = [
      "mcp_servers:",
      "  filesystem:",
      "    command: npx",
      "approval:",
      "  channels:",
      "    telegram:",
      "      owner_id: 123",
    ].join("\n");
    const agentsText = "agents:\n  openclaw:\n    name: openclaw\n";
    const s = parseSetupStatus({ configExists: true, configText, agentsText, proxyRunning: true, decisionCount: 4 });
    expect(s.configExists).toBe(true);
    expect(s.downstreams).toEqual(["filesystem"]);
    expect(s.telegramConfigured).toBe(true);
    expect(s.agents).toEqual(["openclaw"]);
    expect(s.proxyRunning).toBe(true);
    expect(s.decisionCount).toBe(4);
  });

  it("treats empty agents.yaml ({}) as no agents and missing telegram as false", () => {
    const s = parseSetupStatus({ configExists: true, configText: "mcp_servers: {}\n", agentsText: "agents: {}\n", proxyRunning: false, decisionCount: 0 });
    expect(s.downstreams).toEqual([]);
    expect(s.agents).toEqual([]);
    expect(s.telegramConfigured).toBe(false);
  });

  it("never throws on malformed yaml — degrades to empty/false", () => {
    const s = parseSetupStatus({ configExists: true, configText: ":::not yaml:::\n  - [", agentsText: "also bad: [", proxyRunning: false, decisionCount: 0 });
    expect(s.configExists).toBe(true);
    expect(s.downstreams).toEqual([]);
    expect(s.agents).toEqual([]);
    expect(s.telegramConfigured).toBe(false);
  });
});

describe("command builders", () => {
  it("downstreamAddCommand quotes the path", () => {
    expect(downstreamAddCommand("~/workspace")).toBe("habena downstream add filesystem ~/workspace");
    expect(downstreamAddCommand("/my dir")).toBe('habena downstream add filesystem "/my dir"');
  });
  it("agentAddCommand includes name + daily budget", () => {
    expect(agentAddCommand("openclaw", 30)).toBe("habena agent add --name openclaw --budget-daily 30");
  });
});
```

**Step 2: Run — verify fail** (`cannot find ./setup-status`).

**Step 3: Implement `packages/web/src/lib/setup-status.ts`**
```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { configDir } from "./config-dir";
import { proxyRunning } from "./approval-ipc";
import { summary } from "./audit";

export interface SetupStatus {
  configExists: boolean;
  downstreams: string[];
  agents: string[];
  telegramConfigured: boolean;
  proxyRunning: boolean;
  decisionCount: number;
}

export interface SetupStatusInput {
  configExists: boolean;
  configText: string | null;
  agentsText: string | null;
  proxyRunning: boolean;
  decisionCount: number;
}

function safeParse(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v = parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function keysOf(obj: unknown): string[] {
  return obj && typeof obj === "object" ? Object.keys(obj as Record<string, unknown>) : [];
}

/** Pure: derive the wizard's view of setup state from already-read inputs. Never throws. */
export function parseSetupStatus(input: SetupStatusInput): SetupStatus {
  const config = safeParse(input.configText);
  const agents = safeParse(input.agentsText);
  const channels = ((config?.approval as Record<string, unknown> | undefined)?.channels) as
    | Record<string, unknown>
    | undefined;
  return {
    configExists: input.configExists,
    downstreams: keysOf(config?.mcp_servers),
    agents: keysOf(agents?.agents),
    telegramConfigured: Boolean(channels?.telegram),
    proxyRunning: input.proxyRunning,
    decisionCount: input.decisionCount,
  };
}

/** IO wrapper: read the config dir + socket + audit count, then parse. */
export function readSetupStatus(): SetupStatus {
  const configPath = join(configDir(), "config.yaml");
  const agentsPath = join(configDir(), "agents.yaml");
  const configExists = existsSync(configPath);
  const read = (p: string): string | null => {
    try {
      return existsSync(p) ? readFileSync(p, "utf8") : null;
    } catch {
      return null;
    }
  };
  let decisionCount = 0;
  try {
    decisionCount = summary().totalDecisions;
  } catch {
    decisionCount = 0;
  }
  return parseSetupStatus({
    configExists,
    configText: read(configPath),
    agentsText: read(agentsPath),
    proxyRunning: proxyRunning(),
    decisionCount,
  });
}

/** Shell-quote a path only if it contains whitespace (good enough for display copy). */
function quoteArg(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s;
}

export function downstreamAddCommand(path: string): string {
  return `habena downstream add filesystem ${quoteArg(path.trim() || "~/workspace")}`;
}

export function agentAddCommand(name: string, budgetDaily: number): string {
  return `habena agent add --name ${name} --budget-daily ${budgetDaily}`;
}
```

**Step 4: Run — verify pass** (6 tests).

**Step 5: Commit**
```bash
git add packages/web/src/lib/setup-status.ts packages/web/src/lib/setup-status.test.ts
git commit -m "feat(web): setup-status lib (config-dir inspection + command builders)"
```

---

## Task 2: `GET /api/setup-status` route

**Files:**
- Create: `packages/web/src/app/api/setup-status/route.ts`
- Test: `packages/web/src/app/api/setup-status/route.test.ts`

**Step 1: Write the failing test** — `route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/setup-status", () => ({ readSetupStatus: vi.fn() }));

import { GET } from "./route";
import { readSetupStatus } from "@/lib/setup-status";

const mockRead = readSetupStatus as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => vi.clearAllMocks());

describe("GET /api/setup-status", () => {
  it("returns the setup status", async () => {
    mockRead.mockReturnValue({ configExists: true, downstreams: ["filesystem"], agents: ["openclaw"], telegramConfigured: false, proxyRunning: true, decisionCount: 2 });
    const res = await GET();
    const body = await res.json();
    expect(body.configExists).toBe(true);
    expect(body.downstreams).toEqual(["filesystem"]);
    expect(body.decisionCount).toBe(2);
  });

  it("degrades to an all-empty status if the reader throws", async () => {
    mockRead.mockImplementation(() => { throw new Error("boom"); });
    const res = await GET();
    const body = await res.json();
    expect(body.configExists).toBe(false);
    expect(body.downstreams).toEqual([]);
    expect(body.proxyRunning).toBe(false);
  });
});
```

**Step 2: Run — verify fail.**

**Step 3: Implement `packages/web/src/app/api/setup-status/route.ts`**
```ts
import { NextResponse } from "next/server";
import { readSetupStatus, type SetupStatus } from "@/lib/setup-status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EMPTY: SetupStatus = {
  configExists: false, downstreams: [], agents: [],
  telegramConfigured: false, proxyRunning: false, decisionCount: 0,
};

export async function GET() {
  try {
    return NextResponse.json(readSetupStatus());
  } catch {
    // Never let the wizard's poller error out — degrade to "nothing set up yet".
    return NextResponse.json(EMPTY);
  }
}
```

**Step 4: Run — verify pass (2 tests).**

**Step 5: Commit**
```bash
git add packages/web/src/app/api/setup-status
git commit -m "feat(web): GET /api/setup-status (read-only config-dir state)"
```

---

## Task 3: CommandBlock component (copy-to-clipboard)

**Files:**
- Create: `packages/web/src/components/command-block.tsx`
- Test: `packages/web/src/components/command-block.test.tsx`

**Step 1: Write the failing test** — `command-block.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandBlock } from "./command-block";

describe("CommandBlock", () => {
  it("shows the command text", () => {
    render(<CommandBlock command="habena init" />);
    expect(screen.getByText("habena init")).toBeInTheDocument();
  });

  it("copies the command to the clipboard on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CommandBlock command="habena init" />);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith("habena init");
  });
});
```

**Step 2: Run — verify fail.**

**Step 3: Implement `packages/web/src/components/command-block.tsx`**
```tsx
"use client";
import { useState } from "react";

export function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };
  return (
    <div className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs">
      <span className="text-[var(--color-muted-foreground)] select-none">$</span>
      <code className="flex-1 overflow-x-auto text-[var(--color-fg)]">{command}</code>
      <button
        onClick={copy}
        aria-label="Copy command"
        className="shrink-0 rounded px-2 py-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}
```

**Step 4: Run — verify pass (2 tests).**

**Step 5: Commit**
```bash
git add packages/web/src/components/command-block.tsx packages/web/src/components/command-block.test.tsx
git commit -m "feat(web): CommandBlock (copy-to-clipboard command display)"
```

---

## Task 4: Wizard page at `/welcome`

**Files:**
- Create: `packages/web/src/app/welcome/page.tsx`
- Test: `packages/web/src/app/welcome/page.test.tsx`

The wizard polls `/api/setup-status`, shows the 5 steps with a live ✓ per step, collects inputs (downstream path, budget, agent target), and derives commands. A step is "done" by these predicates: init→`configExists`; downstream→`downstreams.length>0`; agent→`agents.length>0`; start→`proxyRunning`; prove→`decisionCount>0`.

**Step 1: Write the failing test** — `welcome/page.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

beforeEach(() => vi.restoreAllMocks());

function stubStatus(status: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(status) }));
}
const EMPTY = { configExists: false, downstreams: [], agents: [], telegramConfigured: false, proxyRunning: false, decisionCount: 0 };

describe("Welcome wizard", () => {
  it("shows the init command and marks no steps done when nothing is configured", async () => {
    stubStatus(EMPTY);
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText("habena init")).toBeInTheDocument());
    // 'Initialize' step is present and not yet complete
    expect(screen.getByText(/Initialize/i)).toBeInTheDocument();
    expect(screen.queryByText(/your agent is guarded/i)).toBeNull();
  });

  it("reflects the budget input in the agent command", async () => {
    stubStatus({ ...EMPTY, configExists: true, downstreams: ["filesystem"] });
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/habena agent add/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/daily budget/i), { target: { value: "50" } });
    expect(screen.getByText(/--budget-daily 50/)).toBeInTheDocument();
  });

  it("celebrates when everything is set up and a decision has been recorded", async () => {
    stubStatus({ configExists: true, downstreams: ["filesystem"], agents: ["openclaw"], telegramConfigured: false, proxyRunning: true, decisionCount: 1 });
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/your agent is guarded/i)).toBeInTheDocument());
  });
});
```

**Step 2: Run — verify fail.**

**Step 3: Implement `packages/web/src/app/welcome/page.tsx`**
```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { CommandBlock } from "@/components/command-block";
import { downstreamAddCommand, agentAddCommand, type SetupStatus } from "@/lib/setup-status";

const POLL_MS = 2000;
const EMPTY: SetupStatus = { configExists: false, downstreams: [], agents: [], telegramConfigured: false, proxyRunning: false, decisionCount: 0 };

const TARGETS = [
  { id: "openclaw", label: "OpenClaw", installable: true },
  { id: "hermes", label: "Hermes", installable: false },
  { id: "claude-desktop", label: "Claude Desktop", installable: false },
  { id: "manual", label: "Guard tools manually", installable: false },
];

function StepShell({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
            done ? "bg-[var(--color-allow)] text-black" : "border border-[var(--color-border)] text-[var(--color-muted-foreground)]"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
        {done && <span className="text-xs text-[var(--color-allow)]">done</span>}
      </div>
      <div className="mt-3 pl-7 text-sm text-[var(--color-muted-foreground)]">{children}</div>
    </Card>
  );
}

export default function Welcome() {
  const [status, setStatus] = useState<SetupStatus>(EMPTY);
  const [target, setTarget] = useState("openclaw");
  const [path, setPath] = useState("~/workspace");
  const [budget, setBudget] = useState(30);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const s = (await fetch("/api/setup-status", { cache: "no-store" }).then((r) => r.json())) as SetupStatus;
        if (!cancelled) setStatus(s);
      } catch { /* keep last status */ }
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const agentName = target === "manual" ? "my-agent" : target;
  const installable = useMemo(() => TARGETS.find((t) => t.id === target)?.installable ?? false, [target]);
  const allDone = status.configExists && status.downstreams.length > 0 && status.agents.length > 0 && status.proxyRunning && status.decisionCount > 0;

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Welcome to Habena</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Five steps to a guarded agent. Run each command in your terminal — this page detects each step as you go.
        </p>
      </header>

      {allDone && (
        <div className="mb-4 rounded-lg border border-[var(--color-allow)]/50 bg-[var(--color-allow)]/10 p-4 text-sm text-[var(--color-allow)]">
          ✓ It works — your agent is guarded. See it in <a href="/decisions" className="underline">Decisions</a>.
        </div>
      )}

      <div className="flex flex-col gap-3">
        <StepShell n={1} title="Pick what you're guarding" done={status.configExists}>
          <div className="flex flex-wrap gap-2">
            {TARGETS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTarget(t.id)}
                aria-pressed={target === t.id}
                className={`rounded border px-2 py-1 text-xs ${
                  target === t.id ? "border-[var(--color-accent)] text-[var(--color-fg)]" : "border-[var(--color-border)] text-[var(--color-muted-foreground)]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {!installable && target !== "openclaw" && (
            <p className="mt-2 text-xs">No one-click installer yet — after setup, point {agentName} at Habena as its MCP server.</p>
          )}
        </StepShell>

        <StepShell n={2} title="Initialize" done={status.configExists}>
          <p className="mb-2">Creates <code>~/.habena/config.yaml</code> with the safe <strong>cautious</strong> preset.</p>
          <CommandBlock command="habena init" />
        </StepShell>

        <StepShell n={3} title="Wire a downstream" done={status.downstreams.length > 0}>
          <label className="mb-2 flex items-center gap-2 text-xs">Folder to expose
            <input value={path} onChange={(e) => setPath(e.target.value)} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 font-mono" />
          </label>
          <CommandBlock command={downstreamAddCommand(path)} />
        </StepShell>

        <StepShell n={4} title="Register your agent" done={status.agents.length > 0}>
          <label className="mb-2 flex items-center gap-2 text-xs">Daily budget ($)
            <input type="number" aria-label="daily budget" value={budget} onChange={(e) => setBudget(Number(e.target.value) || 0)} className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 font-mono" />
          </label>
          <CommandBlock command={agentAddCommand(agentName, budget)} />
          {installable && (
            <div className="mt-2">
              <p className="mb-1 text-xs">Then wire {agentName} to use Habena (backs up its config first):</p>
              <CommandBlock command={`habena install ${agentName}`} />
            </div>
          )}
        </StepShell>

        <StepShell n={5} title="Start & prove it" done={status.proxyRunning && status.decisionCount > 0}>
          <p className="mb-2">Start the proxy{status.proxyRunning ? " — running ✓" : ""}, then trigger a tool call and watch it appear in <a href="/decisions" className="underline">Decisions</a>.</p>
          <CommandBlock command="habena start" />
          {status.proxyRunning && status.decisionCount === 0 && (
            <p className="mt-2 text-xs">Proxy is up — waiting for the first tool call…</p>
          )}
        </StepShell>
      </div>
    </main>
  );
}
```

**Step 4: Run — verify pass (3 tests) + tsc.**

**Step 5: Commit**
```bash
git add packages/web/src/app/welcome
git commit -m "feat(web): onboarding wizard at /welcome (guide + live-detect)"
```

---

## Task 5: Overview "Finish setup" CTA

**Files:**
- Modify: `packages/web/src/app/page.tsx`
- Modify/Add test: `packages/web/src/app/page.test.tsx`

When `/api/setup-status` reports `!configExists`, the Overview shows a prominent "Finish setup" CTA linking to `/welcome`; otherwise it's hidden.

**Step 1: Add a failing test** to `page.test.tsx` (keep the existing tests; add):
```tsx
  it("shows a Finish setup CTA when not configured", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (String(url).includes("setup-status")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ configExists: false, downstreams: [], agents: [], telegramConfigured: false, proxyRunning: false, decisionCount: 0 }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, summary: { totalDecisions: 0, allowed: 0, denied: 0, approvalPending: 0, byAgent: [], byTool: [] } }) });
    }));
    const Overview = (await import("./page")).default;
    render(<Overview />);
    await waitFor(() => expect(screen.getByRole("link", { name: /finish setup/i })).toHaveAttribute("href", "/welcome"));
  });
```
> Note: the existing Overview tests stub `fetch` to a single summary response; they ignore the extra `setup-status` call (it resolves to the same stub and the CTA simply won't assert). Confirm they still pass — if the single-response stub causes the CTA to render unexpectedly, make the existing stubs URL-aware too (return `configExists: true` for setup-status).

**Step 2: Run — verify the new test fails.**

**Step 3: Modify `packages/web/src/app/page.tsx`** — add a second poll for setup-status and the CTA. Add near the existing summary state:
```tsx
  const [configured, setConfigured] = useState(true); // assume configured until told otherwise (no CTA flash)
```
In the effect (alongside the summary fetch, or a second fetch in the same `tick`):
```tsx
        const setup = await fetch("/api/setup-status", { cache: "no-store" }).then((x) => x.json());
        if (!cancelled) setConfigured(Boolean(setup?.configExists));
```
And render the CTA above the stat grid:
```tsx
      {!configured && (
        <a href="/welcome" className="mb-4 block rounded-lg border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 p-4 text-sm">
          <strong>Finish setup</strong> — you haven&apos;t configured Habena yet. <span className="underline">Open the setup wizard →</span>
        </a>
      )}
```
(Keep the existing summary cards/hint. The link text must contain "Finish setup" and href `/welcome`.)

**Step 4: Run — verify pass + full suite + tsc.**

**Step 5: Commit**
```bash
git add packages/web/src/app/page.tsx packages/web/src/app/page.test.tsx
git commit -m "feat(web): Overview 'Finish setup' CTA when unconfigured"
```

---

## Task 6: Full sweep + build (controller-run)

**Step 1:** `cd packages/web && timeout 180 npx vitest run 2>&1 | tail -25; echo EXIT=$?` — all suites pass.
**Step 2:** `timeout 120 npx tsc -p tsconfig.json --noEmit > /tmp/claude-1000/tsc.log 2>&1; echo TSC=$?; cat /tmp/claude-1000/tsc.log` — `TSC=0`.
**Step 3 (sandbox off):** `NEXT_TELEMETRY_DISABLED=1 timeout 300 npx next build 2>&1 | tail -30` — "Compiled successfully"; route table lists `/welcome` (static) + `/api/setup-status` (dynamic).
**Step 4:** `git diff --name-only main...HEAD | grep '^packages/core/' && echo "CORE CHANGED" || echo "core untouched ✓"`.

---

## Task 7: Manual verification recipe (user-run)

```bash
# With NOTHING set up yet:
cd packages/web && pnpm dev        # open http://localhost:7700/welcome
# Then, following the wizard, in another terminal:
habena init                        # step 2 turns ✓
habena downstream add filesystem ~/workspace   # step 3 turns ✓
habena agent add --name openclaw --budget-daily 30   # step 4 turns ✓
habena start                       # step 5: "running"
# trigger a tool call through the proxy → step 5 completes, "It works" banner appears
```
**Acceptance checklist:**
- [ ] `/welcome` shows 5 steps; each turns ✓ within ~2s of running its command.
- [ ] The downstream path input and budget input change the shown commands live.
- [ ] Copy buttons copy the exact command.
- [ ] After a real tool call, the "your agent is guarded" banner appears and links to `/decisions`.
- [ ] Overview (`/`) shows "Finish setup" before `habena init`, and hides it after.
- [ ] Keyboard: target buttons, inputs, copy buttons, links are reachable with a visible focus ring.

---

## Done / handoff

When Tasks 1–6 are green and Task 7 is documented in the PR, the dashboard has a guided first-run wizard. Then use `superpowers:finishing-a-development-branch`.

**Follow-on (separate plans):** making spend real (cost attribution) → Spend page; Hermes/Claude-Desktop installers (need core support); Agents drilldown; Policy editor; threat-alerts surface.
