# Workstream C — Approvals Queue Web UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Habena's local web dashboard able to **see and resolve live tool-call approvals** from the browser — the highest-value trust moment — on a proper Tailwind foundation with accessible primitives.

**Architecture:** The running proxy (`habena start`) already exposes pending approvals over a unix-domain socket at `~/.habena/agentguard.sock` using a newline-delimited JSON protocol (`list_pending`→`pending_list`, `respond`→`respond_ack`). The Next.js dashboard is a *separate process* and today only reads `audit.db` read-only. This plan adds a **web-side IPC client** so Next.js route handlers (Node runtime) connect to that socket on demand, plus two API routes (`GET /api/approvals`, `POST /api/approvals/respond`) and an accessible **approvals-queue UI** that polls them. The browser is the "at-my-desk" twin of the Telegram phone-tap flow.

**Tech Stack:** Next.js 16 (App Router, route handlers in Node runtime) · React 19 · Tailwind CSS v4 (`@tailwindcss/postcss`) · Vitest (new to `packages/web`, for TDD of the lib + routes) · `node:net` unix socket. **No shadcn/Radix yet** — three hand-rolled accessible primitives; shadcn is adopted in the follow-on nav/decision-stream increment where the data-table + command palette justify it.

**Scope (explicit):** Do-first items #1 (Tailwind foundation + a11y contrast fix) and #2 (approvals queue end-to-end). **Out of scope** (follow-on plans): decision-stream migration to the new shell, left-nav/top-status-bar app shell, spend gauges, onboarding wizard, threat alerts. We keep the existing `/` decision-stream page untouched and add `/approvals` alongside it.

**Key constraints (from `habena-sandbox-testing-gotchas` memory):**
- The Bash sandbox **cannot bind unix sockets** (EPERM) and **cannot run `next dev`/`next build`** reliably. Therefore: (a) the IPC client is structured to talk over an **injected duplex stream**, so its tests use in-memory `PassThrough` pairs — *no real socket in tests*; (b) `next build`/visual checks are a **manual verification recipe** the user runs, not an automated step.
- Run vitest as `npx vitest run <file>`; if output is swallowed, dispatch a subagent to run+report, or `timeout 60 npx vitest run … --reporter=json --outputFile=/tmp/claude-1000/x.json`.
- `/tmp` is read-only; use `/tmp/claude-1000/`.

---

## Reference: the wire protocol (already implemented in core, do NOT modify core)

From `packages/core/src/ipc/protocol.ts` and `ipc/server.ts`. The web client must mirror just this much:

```
Client → Server:  {"type":"list_pending"}\n
Server → Client:  {"type":"pending_list","pending":[SerializedPendingApproval,…]}\n

Client → Server:  {"type":"respond","id":"<uuid>","choice":"allow_once|allow_session|deny","durationMs"?,"note"?}\n
Server → Client:  {"type":"respond_ack","id":"<uuid>","ok":true}\n
                  {"type":"respond_ack","id":"<uuid>","ok":false,"reason":"unknown approval id …"}\n
```

`SerializedPendingApproval` =
```ts
{ id: string; agentType: string; instanceId: string; tool: string;
  args: Record<string, unknown>; reason: string; estimatedCost: number;
  createdAt: string; expiresAt: string; }   // createdAt/expiresAt are ISO strings
```

On connect the server also sends `{"type":"hello",…}` and replays pending as `approval_request` messages — the web client **ignores** those and relies on the explicit `list_pending`/`pending_list` round-trip (deterministic). Socket path = `join(configDir(), "agentguard.sock")` — `configDir()` already exists in `packages/web/src/lib/audit.ts`.

---

## Task 1: Tailwind v4 foundation + accessible design tokens

**Files:**
- Create: `packages/web/postcss.config.mjs`
- Create: `packages/web/src/app/globals.css`
- Modify: `packages/web/src/app/layout.tsx`
- Modify: `packages/web/package.json` (add deps)

**Step 1: Add Tailwind v4 deps**

Run (from repo root):
```bash
npm --prefix packages/web install -D tailwindcss@^4 @tailwindcss/postcss@^4 --cache /tmp/claude-1000/npm-cache
```
Expected: `tailwindcss` + `@tailwindcss/postcss` appear under `devDependencies`. (If the workspace pnpm store fights this, fall back to editing `package.json` devDependencies by hand and running `pnpm install --prefer-offline`; the executor records whichever worked.)

**Step 2: PostCSS config**

Create `packages/web/postcss.config.mjs`:
```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
```

**Step 3: Global stylesheet with the a11y-fixed token ramp**

Create `packages/web/src/app/globals.css`. The **muted-foreground contrast fix is baked in here** (`--color-muted-foreground` chosen ≥4.5:1 on the dark surface — verified design-doc requirement). Dark-first is a taste choice; tokens are a small disciplined ramp.

```css
@import "tailwindcss";

@theme {
  /* Surfaces (dark-first) */
  --color-bg: #0b0b0d;
  --color-surface: #141417;
  --color-surface-2: #1a1a1f;
  --color-border: #2a2a32;

  /* Text — muted is #a1a1ac on #0b0b0d ≈ 7.7:1, well past WCAG AA 4.5:1
     (fixes shadcn issue #8088's 4.34:1 default we deliberately avoid). */
  --color-fg: #eaeaea;
  --color-muted-foreground: #a1a1ac;

  /* One accent + status ramp (each used with a SECOND channel — icon/shape — never color alone) */
  --color-accent: #6e8bff;
  --color-allow: #34d399;   /* green  ≈ 7:1 on bg */
  --color-deny: #f87171;    /* red    ≈ 5.9:1 on bg */
  --color-warn: #fbbf24;    /* amber  ≈ 10:1 on bg */

  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: var(--color-bg); color: var(--color-fg); }

/* Focus ring ≥3:1 non-text contrast on every interactive element (verified a11y req). */
:where(button, a, input, [tabindex]):focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

**Step 4: Wire the stylesheet in the layout**

Modify `packages/web/src/app/layout.tsx` — add the import at the top:
```tsx
import "./globals.css";
import type { ReactNode } from "react";
```
(leave the rest unchanged.)

**Step 5: Verify it compiles**

Run:
```bash
timeout 120 npx --prefix packages/web tsc -p packages/web/tsconfig.json --noEmit 2>&1 | tail -20; echo EXIT=${PIPESTATUS[0]}
```
Expected: `EXIT=0` (CSS import doesn't break tsc). A real `next build` is part of the **manual verification recipe** in Task 9 (sandbox can't run it).

**Step 6: Commit**
```bash
git add packages/web/postcss.config.mjs packages/web/src/app/globals.css packages/web/src/app/layout.tsx packages/web/package.json
git commit -m "feat(web): Tailwind v4 foundation with a11y-fixed token ramp"
```

---

## Task 2: Vitest setup in `packages/web`

**Files:**
- Create: `packages/web/vitest.config.ts`
- Modify: `packages/web/package.json` (add `test` script + devDeps)

**Step 1: Add vitest**
```bash
npm --prefix packages/web install -D vitest@^2 --cache /tmp/claude-1000/npm-cache
```

**Step 2: Vitest config** — `packages/web/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
```

**Step 3: Add the test script** — in `packages/web/package.json` `scripts`, add:
```json
"test": "vitest run"
```

**Step 4: Verify the runner starts (no tests yet → exits 0 with "no test files")**
```bash
cd packages/web && timeout 60 npx vitest run 2>&1 | tail -10; echo EXIT=$?
```
Expected: exit 0, "No test files found" is acceptable at this point.

**Step 5: Commit**
```bash
git add packages/web/vitest.config.ts packages/web/package.json
git commit -m "test(web): add vitest runner"
```

---

## Task 3: Web IPC client lib (stream-injected, sandbox-testable)

**Files:**
- Create: `packages/web/src/lib/approval-protocol.ts` (pure encode/decode + types — mirrors core, no socket)
- Create: `packages/web/src/lib/approval-protocol.test.ts`
- Create: `packages/web/src/lib/approval-ipc.ts` (round-trips over an injected `Duplex`)
- Create: `packages/web/src/lib/approval-ipc.test.ts`

> Web can't import core (see the comment in `audit.ts`), so we mirror the minimal protocol. Kept tiny and pure so it's trivially testable.

**Step 1: Write the failing protocol test** — `packages/web/src/lib/approval-protocol.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { encode, decodeLines } from "./approval-protocol";

describe("approval-protocol", () => {
  it("encodes a client message as one newline-terminated JSON line", () => {
    expect(encode({ type: "list_pending" })).toBe('{"type":"list_pending"}\n');
  });

  it("decodes complete lines and preserves a partial remainder", () => {
    const buf = '{"type":"pending_list","pending":[]}\n{"type":"hel';
    const { messages, remainder } = decodeLines(buf);
    expect(messages).toEqual([{ type: "pending_list", pending: [] }]);
    expect(remainder).toBe('{"type":"hel');
  });

  it("skips malformed lines without throwing", () => {
    const { messages } = decodeLines("not json\n{\"type\":\"respond_ack\",\"id\":\"x\",\"ok\":true}\n");
    expect(messages).toEqual([{ type: "respond_ack", id: "x", ok: true }]);
  });
});
```

**Step 2: Run it — verify it fails**
```bash
cd packages/web && timeout 60 npx vitest run src/lib/approval-protocol.test.ts 2>&1 | tail -15; echo EXIT=$?
```
Expected: FAIL — cannot find module `./approval-protocol`.

**Step 3: Implement `packages/web/src/lib/approval-protocol.ts`**
```ts
// Minimal mirror of packages/core/src/ipc/protocol.ts — web can't import core.
// Keep field names/shapes byte-identical to the core protocol.

export type ApprovalChoice = "allow_once" | "allow_session" | "deny";

export interface SerializedPendingApproval {
  id: string;
  agentType: string;
  instanceId: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  estimatedCost: number;
  createdAt: string;
  expiresAt: string;
}

export type ServerMessage =
  | { type: "hello"; version: string }
  | { type: "approval_request"; id: string; pending: SerializedPendingApproval }
  | { type: "approval_resolved"; id: string; outcome: ApprovalChoice }
  | { type: "respond_ack"; id: string; ok: boolean; reason?: string }
  | { type: "pending_list"; pending: SerializedPendingApproval[] }
  | { type: "error"; message: string };

export type ClientMessage =
  | { type: "respond"; id: string; choice: ApprovalChoice; durationMs?: number; note?: string }
  | { type: "list_pending" };

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg) + "\n";
}

export function decodeLines(buffer: string): { messages: unknown[]; remainder: string } {
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";
  const messages: unknown[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line));
    } catch {
      /* skip malformed */
    }
  }
  return { messages, remainder };
}
```

**Step 4: Run protocol test — verify pass**
```bash
cd packages/web && timeout 60 npx vitest run src/lib/approval-protocol.test.ts 2>&1 | tail -15; echo EXIT=$?
```
Expected: PASS (3 tests).

**Step 5: Write the failing IPC test** — `packages/web/src/lib/approval-ipc.test.ts`. Uses a **PassThrough pair** as a fake socket plus a tiny fake server that speaks the protocol — **no real unix socket** (sandbox-safe).
```ts
import { describe, it, expect } from "vitest";
import { PassThrough, type Duplex } from "node:stream";
import { listPending, respond } from "./approval-ipc";
import { encode, decodeLines, type SerializedPendingApproval } from "./approval-protocol";

// A fake "proxy" that pipes client→server→client over two PassThroughs,
// mimicking IpcServer's behavior for the two messages we use.
function fakeProxy(pending: SerializedPendingApproval[]): () => Duplex {
  return () => {
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    // On connect, the real server sends hello — assert the client ignores it.
    toClient.write(encode({ type: "hello", version: "test" }));
    let buf = "";
    toServer.on("data", (chunk) => {
      buf += chunk.toString();
      const { messages, remainder } = decodeLines(buf);
      buf = remainder;
      for (const m of messages as any[]) {
        if (m.type === "list_pending") {
          toClient.write(encode({ type: "pending_list", pending }));
        } else if (m.type === "respond") {
          const known = pending.some((p) => p.id === m.id);
          toClient.write(
            encode(known
              ? { type: "respond_ack", id: m.id, ok: true }
              : { type: "respond_ack", id: m.id, ok: false, reason: "unknown approval id" })
          );
        }
      }
    });
    // The Duplex the client uses: writes go to server, reads come from client-bound stream.
    return Object.assign(toClient, {
      write: toServer.write.bind(toServer),
      end: () => { toServer.end(); toClient.end(); },
    }) as unknown as Duplex;
  };
}

const SAMPLE: SerializedPendingApproval = {
  id: "abc", agentType: "openclaw", instanceId: "inst-1", tool: "fs.write",
  args: { path: "/etc/hosts" }, reason: "write requires approval", estimatedCost: 0,
  createdAt: "2026-06-09T00:00:00.000Z", expiresAt: "2026-06-09T00:00:30.000Z",
};

describe("approval-ipc", () => {
  it("listPending returns the server's pending_list and ignores hello", async () => {
    const got = await listPending({ connect: fakeProxy([SAMPLE]) });
    expect(got).toEqual([SAMPLE]);
  });

  it("listPending returns [] when nothing is pending", async () => {
    expect(await listPending({ connect: fakeProxy([]) })).toEqual([]);
  });

  it("respond returns ok for a known id", async () => {
    const r = await respond("abc", "deny", { connect: fakeProxy([SAMPLE]) });
    expect(r).toEqual({ ok: true });
  });

  it("respond returns ok:false + reason for an unknown id", async () => {
    const r = await respond("nope", "allow_once", { connect: fakeProxy([SAMPLE]) });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unknown approval id/);
  });

  it("rejects on timeout when the server never answers", async () => {
    const silent = () => new PassThrough() as unknown as Duplex;
    await expect(listPending({ connect: silent, timeoutMs: 50 })).rejects.toThrow(/timed out/i);
  });
});
```

**Step 6: Run it — verify it fails**
```bash
cd packages/web && timeout 60 npx vitest run src/lib/approval-ipc.test.ts 2>&1 | tail -20; echo EXIT=$?
```
Expected: FAIL — cannot find `./approval-ipc`.

**Step 7: Implement `packages/web/src/lib/approval-ipc.ts`**
```ts
import { createConnection } from "node:net";
import type { Duplex } from "node:stream";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  encode,
  decodeLines,
  type ServerMessage,
  type ClientMessage,
  type ApprovalChoice,
  type SerializedPendingApproval,
} from "./approval-protocol";

const SOCKET_FILE = "agentguard.sock";

function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  if (p === "~") return homedir();
  return p;
}
function configDir(): string {
  const override = process.env.HABENA_CONFIG_DIR ?? process.env.AGENTGUARD_CONFIG_DIR;
  if (override && override.trim() !== "") return expandHome(override.trim());
  const habena = join(homedir(), ".habena");
  if (existsSync(habena)) return habena;
  const legacy = join(homedir(), ".agentguard");
  if (existsSync(legacy)) return legacy;
  return habena;
}
export function socketPath(): string {
  return join(configDir(), SOCKET_FILE);
}
export function proxyRunning(): boolean {
  return existsSync(socketPath());
}

/** Injectable connector — default opens the real unix socket; tests pass a fake Duplex. */
export interface IpcOptions {
  connect?: () => Duplex;
  timeoutMs?: number;
}
function defaultConnect(): Duplex {
  return createConnection(socketPath()) as unknown as Duplex;
}

/** Generic one-shot: send a request, resolve when `match` returns a value, then close. */
function roundTrip<T>(
  request: ClientMessage,
  match: (msg: ServerMessage) => T | undefined,
  opts: IpcOptions
): Promise<T> {
  const conn = (opts.connect ?? defaultConnect)();
  const timeoutMs = opts.timeoutMs ?? 2000;
  return new Promise<T>((resolve, reject) => {
    let buffer = "";
    const cleanup = () => {
      clearTimeout(timer);
      conn.removeAllListeners("data");
      conn.removeAllListeners("error");
      try { (conn as any).end?.(); } catch { /* noop */ }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for proxy response"));
    }, timeoutMs);
    conn.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const { messages, remainder } = decodeLines(buffer);
      buffer = remainder;
      for (const raw of messages) {
        const hit = match(raw as ServerMessage);
        if (hit !== undefined) { cleanup(); resolve(hit); return; }
      }
    });
    conn.on("error", (err: Error) => { cleanup(); reject(err); });
    conn.write(encode(request));
  });
}

export async function listPending(opts: IpcOptions = {}): Promise<SerializedPendingApproval[]> {
  return roundTrip(
    { type: "list_pending" },
    (msg) => (msg.type === "pending_list" ? msg.pending : undefined),
    opts
  );
}

export async function respond(
  id: string,
  choice: ApprovalChoice,
  opts: IpcOptions = {}
): Promise<{ ok: boolean; reason?: string }> {
  return roundTrip(
    { type: "respond", id, choice },
    (msg) =>
      msg.type === "respond_ack" && msg.id === id
        ? { ok: msg.ok, reason: msg.reason }
        : undefined,
    opts
  );
}
```

**Step 8: Run IPC test — verify pass**
```bash
cd packages/web && timeout 60 npx vitest run src/lib/approval-ipc.test.ts 2>&1 | tail -20; echo EXIT=$?
```
Expected: PASS (5 tests). If output is swallowed, dispatch a subagent to run+report.

**Step 9: Commit**
```bash
git add packages/web/src/lib/approval-protocol.ts packages/web/src/lib/approval-protocol.test.ts packages/web/src/lib/approval-ipc.ts packages/web/src/lib/approval-ipc.test.ts
git commit -m "feat(web): stream-testable IPC client for the proxy approval socket"
```

---

## Task 4: `GET /api/approvals` route

**Files:**
- Create: `packages/web/src/app/api/approvals/route.ts`
- Create: `packages/web/src/app/api/approvals/route.test.ts`

**Step 1: Write the failing test** — `route.test.ts`. We test the handler directly (no socket) by stubbing the lib via `vi.mock`.
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/approval-ipc", () => ({
  proxyRunning: vi.fn(),
  listPending: vi.fn(),
  socketPath: () => "/fake/agentguard.sock",
}));

import { GET } from "./route";
import { proxyRunning, listPending } from "@/lib/approval-ipc";

const mockRunning = proxyRunning as unknown as ReturnType<typeof vi.fn>;
const mockList = listPending as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("GET /api/approvals", () => {
  it("returns ok:false + hint when the proxy isn't running", async () => {
    mockRunning.mockReturnValue(false);
    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.pending).toEqual([]);
    expect(body.hint).toMatch(/habena start/i);
  });

  it("returns the pending list when the proxy is up", async () => {
    mockRunning.mockReturnValue(true);
    mockList.mockResolvedValue([{ id: "x", tool: "fs.write" }]);
    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.pending).toHaveLength(1);
  });

  it("degrades gracefully if the socket errors mid-call", async () => {
    mockRunning.mockReturnValue(true);
    mockList.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/ECONNREFUSED/);
  });
});
```

**Step 2: Run — verify fail**
```bash
cd packages/web && timeout 60 npx vitest run src/app/api/approvals/route.test.ts 2>&1 | tail -15; echo EXIT=$?
```
Expected: FAIL — cannot find `./route`.

**Step 3: Implement `packages/web/src/app/api/approvals/route.ts`**
```ts
import { NextResponse } from "next/server";
import { proxyRunning, listPending, socketPath } from "@/lib/approval-ipc";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  if (!proxyRunning()) {
    return NextResponse.json({
      ok: false,
      reason: "proxy not running",
      hint: `No approval socket at ${socketPath()}. Start the proxy: habena start`,
      pending: [],
    });
  }
  try {
    const pending = await listPending();
    return NextResponse.json({ ok: true, pending });
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: (err as Error).message, pending: [] },
      { status: 200 }
    );
  }
}
```

**Step 4: Run — verify pass**
```bash
cd packages/web && timeout 60 npx vitest run src/app/api/approvals/route.test.ts 2>&1 | tail -15; echo EXIT=$?
```
Expected: PASS (3 tests).

**Step 5: Commit**
```bash
git add packages/web/src/app/api/approvals/route.ts packages/web/src/app/api/approvals/route.test.ts
git commit -m "feat(web): GET /api/approvals lists live pending approvals"
```

---

## Task 5: `POST /api/approvals/respond` route

**Files:**
- Create: `packages/web/src/app/api/approvals/respond/route.ts`
- Create: `packages/web/src/app/api/approvals/respond/route.test.ts`

**Step 1: Write the failing test**
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/approval-ipc", () => ({
  respond: vi.fn(),
}));

import { POST } from "./route";
import { respond } from "@/lib/approval-ipc";

const mockRespond = respond as unknown as ReturnType<typeof vi.fn>;
const req = (body: unknown) =>
  new Request("http://localhost/api/approvals/respond", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/approvals/respond", () => {
  it("rejects an invalid choice with 400", async () => {
    const res = await POST(req({ id: "x", choice: "nuke" }));
    expect(res.status).toBe(400);
    expect(mockRespond).not.toHaveBeenCalled();
  });

  it("rejects a missing id with 400", async () => {
    const res = await POST(req({ choice: "deny" }));
    expect(res.status).toBe(400);
  });

  it("forwards a valid deny and returns ok", async () => {
    mockRespond.mockResolvedValue({ ok: true });
    const res = await POST(req({ id: "abc", choice: "deny" }));
    expect(mockRespond).toHaveBeenCalledWith("abc", "deny");
    expect((await res.json()).ok).toBe(true);
  });

  it("surfaces ok:false from a stale id (409)", async () => {
    mockRespond.mockResolvedValue({ ok: false, reason: "unknown approval id" });
    const res = await POST(req({ id: "stale", choice: "allow_once" }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toMatch(/unknown/);
  });
});
```

**Step 2: Run — verify fail.**
```bash
cd packages/web && timeout 60 npx vitest run src/app/api/approvals/respond/route.test.ts 2>&1 | tail -15; echo EXIT=$?
```
Expected: FAIL — cannot find `./route`.

**Step 3: Implement `packages/web/src/app/api/approvals/respond/route.ts`**
```ts
import { NextResponse } from "next/server";
import { respond } from "@/lib/approval-ipc";
import type { ApprovalChoice } from "@/lib/approval-protocol";

export const dynamic = "force-dynamic";

const VALID: ReadonlySet<ApprovalChoice> = new Set(["allow_once", "allow_session", "deny"]);

export async function POST(request: Request) {
  let body: { id?: unknown; choice?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const choice = body.choice as ApprovalChoice;
  if (!id || !VALID.has(choice)) {
    return NextResponse.json(
      { ok: false, reason: "id (string) and choice (allow_once|allow_session|deny) required" },
      { status: 400 }
    );
  }
  try {
    const result = await respond(id, choice);
    // ok:false here means the id was stale/expired/unknown — that's a conflict, not a 500.
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: (err as Error).message }, { status: 502 });
  }
}
```

**Step 4: Run — verify pass.**
```bash
cd packages/web && timeout 60 npx vitest run src/app/api/approvals/respond/route.test.ts 2>&1 | tail -15; echo EXIT=$?
```
Expected: PASS (4 tests).

**Step 5: Commit**
```bash
git add packages/web/src/app/api/approvals/respond
git commit -m "feat(web): POST /api/approvals/respond resolves an approval via the proxy"
```

---

## Task 6: Accessible UI primitives (Badge, Button, Card)

**Files:**
- Create: `packages/web/src/components/ui/badge.tsx`
- Create: `packages/web/src/components/ui/button.tsx`
- Create: `packages/web/src/components/ui/card.tsx`

These are tiny, native-element, Tailwind-styled primitives. **No tests** (pure presentational; verified visually in Task 9). a11y requirements baked in: native `<button>`, `focus-visible` ring (from globals.css), and **status conveyed by color + icon/shape** (never color alone — verified Carbon/WCAG req).

**Step 1: `badge.tsx`** — color + a leading glyph (second channel):
```tsx
type Kind = "allow" | "deny" | "warn" | "neutral";

const STYLES: Record<Kind, { cls: string; glyph: string; label: string }> = {
  allow:   { cls: "text-[var(--color-allow)] border-[var(--color-allow)]/50 bg-[var(--color-allow)]/10", glyph: "✓", label: "allowed" },
  deny:    { cls: "text-[var(--color-deny)] border-[var(--color-deny)]/50 bg-[var(--color-deny)]/10",     glyph: "⛔", label: "denied" },
  warn:    { cls: "text-[var(--color-warn)] border-[var(--color-warn)]/50 bg-[var(--color-warn)]/10",     glyph: "⏳", label: "needs approval" },
  neutral: { cls: "text-[var(--color-muted-foreground)] border-[var(--color-border)] bg-[var(--color-surface-2)]", glyph: "•", label: "info" },
};

export function Badge({ kind, children }: { kind: Kind; children?: React.ReactNode }) {
  const s = STYLES[kind];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold ${s.cls}`}
    >
      <span aria-hidden>{s.glyph}</span>
      <span>{children ?? s.label}</span>
    </span>
  );
}
```

**Step 2: `button.tsx`** — variants; the **destructive (deny) action is visually distinct and is NOT the auto-focused/primary button** (mis-tap guard, verified design intent):
```tsx
type Variant = "primary" | "safe" | "danger" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary: "bg-[var(--color-accent)] text-black hover:opacity-90",
  safe:    "bg-[var(--color-surface-2)] text-[var(--color-fg)] border border-[var(--color-border)] hover:border-[var(--color-accent)]",
  danger:  "bg-transparent text-[var(--color-deny)] border border-[var(--color-deny)]/60 hover:bg-[var(--color-deny)]/10",
  ghost:   "bg-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-fg)]",
};

export function Button(
  { variant = "safe", className = "", ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${VARIANT[variant]} ${className}`}
      {...props}
    />
  );
}
```

**Step 3: `card.tsx`**:
```tsx
export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] ${className}`}>
      {children}
    </div>
  );
}
```

**Step 4: Type-check**
```bash
timeout 120 npx --prefix packages/web tsc -p packages/web/tsconfig.json --noEmit 2>&1 | tail -20; echo EXIT=${PIPESTATUS[0]}
```
Expected: `EXIT=0`.

**Step 5: Commit**
```bash
git add packages/web/src/components/ui
git commit -m "feat(web): accessible Badge/Button/Card primitives (color+icon, focus ring)"
```

---

## Task 7: Approvals queue UI + `/approvals` page

**Files:**
- Create: `packages/web/src/components/approval-card.tsx`
- Create: `packages/web/src/app/approvals/page.tsx`

**Design requirements honored (from the UI/UX design doc, verified items):**
- Show the agent's **real requested tool + args faithfully** (truncated, never misleading) — the *lies-in-the-loop* guard.
- **Plain-language rationale** (`reason`) — giving a why measurably improves correct decisions.
- **Countdown to timeout** (from `expiresAt`); a calm warning as it nears zero.
- **Safe choice is the low-friction default; destructive (Deny) is not the easy primary** — button order/styling enforces this.
- Empty state that **teaches** ("No approvals waiting — when your agent hits a guarded tool, it shows up here").
- Proxy-down state is **friendly**, not an error wall.

**Step 1: `approval-card.tsx`** (client component):
```tsx
"use client";
import { useEffect, useState } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import type { SerializedPendingApproval, ApprovalChoice } from "@/lib/approval-protocol";

function truncateArgs(args: Record<string, unknown>, max = 600): string {
  const s = JSON.stringify(args, null, 2);
  return s.length > max ? s.slice(0, max) + "\n… (truncated)" : s;
}
function secondsLeft(expiresAt: string, nowMs: number): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - nowMs) / 1000));
}

export function ApprovalCard(
  { p, onResolve }: { p: SerializedPendingApproval; onResolve: (id: string, choice: ApprovalChoice) => void }
) {
  // Tick once a second for the countdown. Initialized lazily to avoid SSR/clock mismatch.
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = nowMs === null ? null : secondsLeft(p.expiresAt, nowMs);
  const urgent = left !== null && left <= 10;

  const act = (choice: ApprovalChoice) => { setBusy(true); onResolve(p.id, choice); };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-[var(--color-muted-foreground)]">
            <span className="font-mono text-[var(--color-fg)]">{p.agentType}</span>
            {" wants to call "}
            <span className="font-mono text-[var(--color-fg)]">{p.tool}</span>
          </div>
          <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">{p.reason}</div>
        </div>
        <Badge kind="warn">
          {left === null ? "needs approval" : urgent ? `${left}s left` : `expires in ${left}s`}
        </Badge>
      </div>

      <pre className="mt-3 max-h-48 overflow-auto rounded bg-[var(--color-bg)] p-3 text-xs text-[var(--color-fg)] font-mono">
{truncateArgs(p.args)}
      </pre>

      {/* Safe choices first/low-friction; Deny is visually separated and not the primary. */}
      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" disabled={busy} onClick={() => act("allow_once")}>Allow once</Button>
        <Button variant="safe" disabled={busy} onClick={() => act("allow_session")}>Allow this session</Button>
        <div className="flex-1" />
        <Button variant="danger" disabled={busy} onClick={() => act("deny")}>⛔ Deny</Button>
      </div>
    </Card>
  );
}
```

**Step 2: `approvals/page.tsx`** (client page, polls `/api/approvals` every 1s; optimistic removal on respond):
```tsx
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApprovalCard } from "@/components/approval-card";
import type { SerializedPendingApproval, ApprovalChoice } from "@/lib/approval-protocol";

type ListResp = { ok: boolean; reason?: string; hint?: string; pending: SerializedPendingApproval[] };
const POLL_MS = 1000;

export default function ApprovalsPage() {
  const [pending, setPending] = useState<SerializedPendingApproval[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [down, setDown] = useState(false);
  const resolving = useRef<Set<string>>(new Set());

  const tick = useCallback(async () => {
    try {
      const r = (await fetch("/api/approvals", { cache: "no-store" }).then((x) => x.json())) as ListResp;
      setDown(!r.ok);
      setHint(r.hint ?? r.reason ?? null);
      // Drop any we've optimistically resolved this cycle.
      setPending(r.pending.filter((p) => !resolving.current.has(p.id)));
    } catch (e) {
      setDown(true);
      setHint((e as Error).message);
    }
  }, []);

  useEffect(() => {
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => clearInterval(t);
  }, [tick]);

  const onResolve = useCallback(async (id: string, choice: ApprovalChoice) => {
    resolving.current.add(id);
    setPending((prev) => prev.filter((p) => p.id !== id)); // optimistic
    try {
      await fetch("/api/approvals/respond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, choice }),
      });
    } finally {
      // Re-sync soon; keep it in the resolved-set briefly so the poll doesn't resurrect it.
      setTimeout(() => resolving.current.delete(id), 3000);
    }
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Approvals</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Tool calls your agent paused for your decision.
        </p>
      </header>

      {down && (
        <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-muted-foreground)]">
          {hint ?? "Proxy not reachable."}
        </div>
      )}

      {!down && pending.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          No approvals waiting — when your agent hits a guarded tool, it shows up here.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {pending.map((p) => (
          <ApprovalCard key={p.id} p={p} onResolve={onResolve} />
        ))}
      </div>
    </main>
  );
}
```

**Step 3: Type-check**
```bash
timeout 120 npx --prefix packages/web tsc -p packages/web/tsconfig.json --noEmit 2>&1 | tail -20; echo EXIT=${PIPESTATUS[0]}
```
Expected: `EXIT=0`.

**Step 4: Commit**
```bash
git add packages/web/src/components/approval-card.tsx packages/web/src/app/approvals/page.tsx
git commit -m "feat(web): approvals queue UI — faithful args, rationale, countdown, safe-default actions"
```

---

## Task 8: Full web test sweep + green bar

**Step 1: Run every web test**
```bash
cd packages/web && timeout 120 npx vitest run 2>&1 | tail -25; echo EXIT=$?
```
Expected: all suites pass (protocol 3 + ipc 5 + approvals GET 3 + respond 4 = 15). If vitest output is swallowed in-sandbox, dispatch a subagent to run `npx vitest run` in `packages/web` and report the summary.

**Step 2: Full type-check**
```bash
timeout 120 npx --prefix packages/web tsc -p packages/web/tsconfig.json --noEmit 2>&1 | tail -20; echo EXIT=${PIPESTATUS[0]}
```
Expected: `EXIT=0`.

**Step 3: Confirm core is untouched / still green** (we changed nothing in core, but verify the build guard):
```bash
cd packages/core && timeout 300 npx vitest run --exclude 'tests/ipc/**' --exclude 'tests/e2e/**' 2>&1 | tail -15; echo EXIT=$?
```
Expected: ~265 pass (unchanged). (ipc/e2e excluded — known sandbox-only failures per memory.)

---

## Task 9: Manual verification recipe (user-run — sandbox can't run `next dev`)

This is the real end-to-end proof. Document it in the PR description and have the user (or a non-sandboxed session) run it.

```bash
# Terminal A — proxy with a filesystem downstream + cautious preset
habena init && habena downstream add filesystem ~/workspace && habena start

# Terminal B — the dashboard
cd packages/web && pnpm dev   # http://localhost:7700/approvals

# Terminal C — trigger a guarded call (a write under ~/workspace), e.g. via a test MCP client
#   → the cautious preset marks writes as require_approval
```
**Expect:** within ~1s a card appears at `/approvals` showing the real tool + args + reason + a live countdown. Click **Deny** → the card disappears, the agent's call is blocked, and `habena logs --decision require_approval` shows the record. Click **Allow once** on a fresh one → the write goes through. Cross-check parity with `habena watch` (CLI) and the Telegram tap — all three resolve the same queue.

**Acceptance checklist:**
- [ ] Pending approval appears in the browser within ~1s of being raised.
- [ ] Args shown match what the agent actually requested (lies-in-the-loop guard).
- [ ] Allow once / Allow session / Deny each resolve the call correctly and the card clears.
- [ ] Countdown ticks down; on timeout the card clears (queue auto-denies per `timeoutAction`).
- [ ] Proxy stopped → `/approvals` shows the calm "proxy not reachable / habena start" hint, not a crash.
- [ ] Muted text and focus rings are legible (a11y); badges read by icon+text with color off.

---

## Done / handoff

When Tasks 1–8 are green and Task 9's recipe is documented in the PR, this increment is complete:
**the browser can resolve live approvals.** Then use `superpowers:finishing-a-development-branch` to open the PR.

**Follow-on plans (separate docs, not this one):**
- App shell: left nav (Overview · Decisions · Approvals · Agents · Spend · Policy) + top status bar with pending-approvals count; migrate the existing `/` decision-stream into it. **This is where shadcn/ui + the data-table + Cmd+K command palette get adopted** (their payoff lands here).
- Spend gauges (top bar + Spend page) — research-gap, validate the pattern.
- Onboarding wizard (4–5 steps, progressive disclosure, ends on a test-call aha).
- Threat alerts surface (feeds from Workstream B).
