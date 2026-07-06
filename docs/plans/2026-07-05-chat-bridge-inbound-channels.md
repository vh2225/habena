# Chat Bridge + Inbound Channel Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human talk to their guarded agent — from the web dashboard first, Telegram second — with every chat-originated action flowing through Habena's existing policy/budget/approval path, plus per-channel rate limits and a Telegram policy floor.

**Architecture:** A new `src/chat/` module in `packages/core`: an `AgentBridge` interface with an OpenClaw implementation (WebSocket operator client to the OpenClaw gateway's `chat.send`/event stream), and a `ChatChannelManager` that authenticates/rate-limits inbound messages, serializes runs, tracks which channel originated the active run, and fans replies out to subscribers. The existing Unix-socket IPC gains chat frames; habena-web gains a chat page (SSE streaming); the existing Telegram approval channel gains an owner-only inbound hook. The proxy applies a stricter-of-two policy floor while a Telegram-originated run is active, and Telegram-originated approvals can only be *allowed* from the web dashboard (true two-channel confirmation: phone commands, Mac approves).

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Node >= 20, vitest, `ws` (new dependency, WebSocket client + test server), Next.js App Router (packages/web), existing NDJSON Unix-socket IPC.

**Repo:** `~/github/agentguard` on jarvis-vm (run all commands there, e.g. via `orb -m jarvis-vm -u vhoang`). Specs: `docs/specs/2026-07-05-habena-home-design.md`, `docs/specs/2026-04-15-phase7-chat-channels.md`.

## Global Constraints

- Node `>=20`, `"type": "module"` — every relative import ends in `.js`.
- Tests: vitest; core tests live in `packages/core/tests/<area>/` mirroring `src/<area>/`; web tests are colocated (`route.test.ts` next to `route.ts`).
- Run core tests: `cd packages/core && npx vitest run tests/chat/ --reporter=verbose` (a bare `pnpm test` runs `tsc && vitest run` — use it before each commit).
- Only new dependency allowed: `ws` (+ `@types/ws` dev) in `packages/core`.
- Secrets (bot tokens, gateway tokens) must NEVER appear in logs, errors, audit entries, or IPC frames — mirror the discipline documented at the top of `src/approval/channels/telegram.ts`.
- Fail closed: bridge down → chat reports `offline` and accepts nothing; unknown channel or non-owner sender → drop + audit.
- Channels carry conversation, never policy: no chat/IPC frame added by this plan may mutate config or policy (rearm is the one deliberate exception and only *restores* a configured state).
- Every task: Red → Green → commit. Commit messages follow repo style (`feat(chat): …`, `test(chat): …`).
- Injectable clocks everywhere (`now?: () => Date` / `() => number`) — no bare `Date.now()` in logic under test.

## Out of scope (deliberate, do not add)

- Hermes bridge (interface stays pluggable; OpenClaw only for now).
- Signal/Slack/iMessage adapters, quiet hours, heartbeats, denial cache-invalidation, multi-approver quorum (Phase 7 items not pulled into Habena Home sub-project 1).
- Guided-mode visual polish (sub-project 2 restyles the chat page).
- Multi-agent attribution — v1 is single-agent, single bridge session, one run at a time.

---

### Task 1: Gateway protocol probe + recorded fixtures

The OpenClaw gateway WS handshake is documented (`/home/vhoang/.nvm/versions/node/v22.22.2/lib/node_modules/openclaw/docs/gateway/protocol.md`) but the exact `chat.send` params, event names for streamed chat updates, and whether loopback token auth needs the `device` signature block must be pinned against the live gateway on :18789 before the bridge is built. This task produces a committed fixture file the FakeGateway (Task 4) and OpenClawBridge (Task 5) are written against.

**Files:**
- Create: `packages/core/scripts/probe-gateway.mjs`
- Create: `packages/core/tests/chat/fixtures/gateway-frames.json`

**Interfaces:**
- Produces: `gateway-frames.json` — a JSON object `{ connect: {request, response}, chatSend: {request, response}, events: [...] }` of verbatim frames captured from the live gateway (tokens replaced with `"<REDACTED>"`).

- [ ] **Step 1: Write the probe script**

```js
// packages/core/scripts/probe-gateway.mjs
// One-shot investigator: connects to the local OpenClaw gateway, performs the
// connect handshake, sends one chat message, records every frame in/out for
// 30s, writes tests/chat/fixtures/gateway-frames.json (secrets redacted).
// Usage: OPENCLAW_GATEWAY_TOKEN=... node scripts/probe-gateway.mjs [ws://127.0.0.1:18789]
import { WebSocket } from "ws";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const url = process.argv[2] ?? "ws://127.0.0.1:18789";
const token = process.env.OPENCLAW_GATEWAY_TOKEN;
const frames = [];
const record = (dir, frame) => frames.push({ dir, at: new Date().toISOString(), frame });

const redact = (s) => token ? s.replaceAll(token, "<REDACTED>") : s;
const ws = new WebSocket(url);
const send = (obj) => { const s = JSON.stringify(obj); record("out", JSON.parse(redact(s))); ws.send(s); };

ws.on("message", (data) => {
  const frame = JSON.parse(redact(data.toString()));
  record("in", frame);
  // Reply to the pre-connect challenge with a connect request.
  if (frame.type === "event" && frame.event === "connect.challenge") {
    send({
      type: "req", id: randomUUID(), method: "connect",
      params: {
        minProtocol: 3, maxProtocol: 4,
        client: { id: "habena-probe", version: "0.0.1", platform: "linux", mode: "operator" },
        role: "operator", scopes: ["operator.read", "operator.write"],
        caps: [], commands: [], permissions: {},
        auth: token ? { token } : undefined,
        locale: "en-US", userAgent: "habena-probe/0.0.1",
      },
    });
  }
  // After hello-ok, send one chat message and just record whatever comes back.
  if (frame.type === "res" && frame.ok && frame.payload?.type === "hello-ok") {
    send({ type: "req", id: randomUUID(), method: "chat.send",
           params: { sessionKey: "habena-probe", text: "Reply with exactly: PROBE_OK", idempotencyKey: randomUUID() } });
  }
});
ws.on("error", (err) => record("in", { probeError: String(err?.message ?? err) }));
setTimeout(() => {
  writeFileSync(new URL("../tests/chat/fixtures/gateway-frames.json", import.meta.url),
    JSON.stringify({ url, capturedAt: new Date().toISOString(), frames }, null, 2));
  console.log(`wrote ${frames.length} frames`);
  ws.close(); process.exit(0);
}, 30_000);
```

- [ ] **Step 2: Add the `ws` dependency**

Run: `cd packages/core && pnpm add ws && pnpm add -D @types/ws`
Expected: `ws` in dependencies, `@types/ws` in devDependencies.

- [ ] **Step 3: Run the probe against the live gateway**

Find the gateway token first: `grep -A3 '"auth"' ~/.openclaw/openclaw.json` (never paste the token into the fixture, chat, or a commit).
Run: `OPENCLAW_GATEWAY_TOKEN=<token> node scripts/probe-gateway.mjs`
Expected: `wrote N frames` (N ≥ 4: challenge, connect req, hello-ok, chat.send req + response/events).

- [ ] **Step 4: Sanity-check + redact the fixture**

Open `tests/chat/fixtures/gateway-frames.json`. Verify: (a) no token or secret anywhere (`grep -i token` shows only `<REDACTED>` or field names), (b) the hello-ok frame is present, (c) chat.send got a response, (d) the streamed reply events are captured — note their exact `event` names and payload shape; Tasks 4–5 must mirror them. If the handshake failed wanting a `device` signature block, capture that error frame too — Task 5's connect params must then include a device identity (generate a keypair, mirror what the OpenClaw CLI stores in `~/.openclaw/identity/`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/scripts/probe-gateway.mjs packages/core/tests/chat/fixtures/gateway-frames.json packages/core/package.json pnpm-lock.yaml
git commit -m "chore(chat): gateway protocol probe + recorded frame fixtures"
```

---

### Task 2: Chat types + config schema

**Files:**
- Create: `packages/core/src/chat/types.ts`
- Modify: `packages/core/src/policy/types.ts` (add `chat?: ChatConfig` to `AgentGuardConfig`, ~line 89)
- Create: `packages/core/src/chat/config.ts`
- Test: `packages/core/tests/chat/config.test.ts`

**Interfaces:**
- Produces (everything downstream imports from `../../src/chat/types.js`):

```ts
export type ChatChannelId = "web" | "telegram";

export interface InboundChatMessage {
  channel: ChatChannelId;
  sender: string; // "local" for web; Telegram numeric user id as string
  text: string;
}

export type BridgeEvent =
  | { kind: "delta"; text: string }
  | { kind: "final"; text: string }
  | { kind: "run_state"; state: "started" | "finished" | "error"; detail?: string }
  | { kind: "connection"; state: "up" | "down" };

export interface AgentBridge {
  readonly kind: string;
  start(): Promise<void>;
  send(text: string): Promise<void>;
  onEvent(cb: (ev: BridgeEvent) => void): () => void; // returns unsubscribe
  stop(): Promise<void>;
  isUp(): boolean;
}

export type ChatEvent =
  | { kind: "user"; channel: ChatChannelId; text: string; at: string }
  | { kind: "assistant_delta"; text: string; at: string }
  | { kind: "assistant_final"; text: string; at: string }
  | { kind: "status"; state: "idle" | "running" | "offline" | "disarmed"; channel?: ChatChannelId; detail?: string; at: string }
  | { kind: "rejected"; channel: ChatChannelId; reason: string; at: string };

export interface ChatBridgeConfig {
  kind: "openclaw";
  url?: string;         // default ws://127.0.0.1:18789
  token?: string;
  token_env?: string;   // env var name holding the gateway token
  session_key?: string; // default "habena-chat"
}

export interface ChatConfig {
  enabled?: boolean;
  bridge?: ChatBridgeConfig;
  channels?: {
    web?: { enabled?: boolean };
    telegram?: {
      inbound?: boolean;              // default false
      commands_per_10min?: number;    // default 10
      policy_floor?: string;          // preset name, default "cautious"
    };
  };
}
```

- Produces from `src/chat/config.ts`: `resolveChatConfig(cfg: AgentGuardConfig): ResolvedChatConfig | null` where

```ts
export interface ResolvedChatConfig {
  bridge: { kind: "openclaw"; url: string; token?: string; sessionKey: string };
  web: { enabled: boolean };
  telegram: { inbound: boolean; commandsPer10Min: number; policyFloor: string };
}
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/chat/config.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { resolveChatConfig } from "../../src/chat/config.js";
import type { AgentGuardConfig } from "../../src/policy/types.js";

afterEach(() => { delete process.env.TEST_GW_TOKEN; });

describe("resolveChatConfig", () => {
  it("returns null when chat is absent or disabled", () => {
    expect(resolveChatConfig({} as AgentGuardConfig)).toBeNull();
    expect(resolveChatConfig({ chat: { enabled: false } } as AgentGuardConfig)).toBeNull();
  });

  it("applies defaults when chat is enabled", () => {
    const r = resolveChatConfig({ chat: { enabled: true } } as AgentGuardConfig);
    expect(r).toEqual({
      bridge: { kind: "openclaw", url: "ws://127.0.0.1:18789", token: undefined, sessionKey: "habena-chat" },
      web: { enabled: true },
      telegram: { inbound: false, commandsPer10Min: 10, policyFloor: "cautious" },
    });
  });

  it("reads the gateway token from token_env", () => {
    process.env.TEST_GW_TOKEN = "sekret";
    const r = resolveChatConfig({
      chat: { enabled: true, bridge: { kind: "openclaw", token_env: "TEST_GW_TOKEN" } },
    } as AgentGuardConfig);
    expect(r?.bridge.token).toBe("sekret");
  });

  it("explicit token wins over token_env; explicit fields override defaults", () => {
    const r = resolveChatConfig({
      chat: {
        enabled: true,
        bridge: { kind: "openclaw", url: "ws://127.0.0.1:9999", token: "abc", session_key: "s1" },
        channels: { web: { enabled: false }, telegram: { inbound: true, commands_per_10min: 3, policy_floor: "deny-all" } },
      },
    } as AgentGuardConfig);
    expect(r).toEqual({
      bridge: { kind: "openclaw", url: "ws://127.0.0.1:9999", token: "abc", sessionKey: "s1" },
      web: { enabled: false },
      telegram: { inbound: true, commandsPer10Min: 3, policyFloor: "deny-all" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/chat/config.test.ts`
Expected: FAIL — cannot resolve `../../src/chat/config.js`.

- [ ] **Step 3: Write types + implementation**

Create `src/chat/types.ts` with exactly the Interfaces block above (the `ChatChannelId` through `ChatConfig` definitions, each with a one-line doc comment). Add to `src/policy/types.ts` inside `AgentGuardConfig`:

```ts
  /** Chat bridge + inbound channels (Habena Home sub-project 1). */
  chat?: import("../chat/types.js").ChatConfig;
```

```ts
// packages/core/src/chat/config.ts
import type { AgentGuardConfig } from "../policy/types.js";

export interface ResolvedChatConfig {
  bridge: { kind: "openclaw"; url: string; token?: string; sessionKey: string };
  web: { enabled: boolean };
  telegram: { inbound: boolean; commandsPer10Min: number; policyFloor: string };
}

/** Normalize the user-facing chat config block. Null = chat feature off. */
export function resolveChatConfig(cfg: AgentGuardConfig): ResolvedChatConfig | null {
  const chat = cfg.chat;
  if (!chat?.enabled) return null;
  const b = chat.bridge;
  const token = b?.token ?? (b?.token_env ? process.env[b.token_env] : undefined);
  return {
    bridge: {
      kind: "openclaw",
      url: b?.url ?? "ws://127.0.0.1:18789",
      token,
      sessionKey: b?.session_key ?? "habena-chat",
    },
    web: { enabled: chat.channels?.web?.enabled ?? true },
    telegram: {
      inbound: chat.channels?.telegram?.inbound ?? false,
      commandsPer10Min: chat.channels?.telegram?.commands_per_10min ?? 10,
      policyFloor: chat.channels?.telegram?.policy_floor ?? "cautious",
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/chat/config.test.ts`
Expected: 4 passed. Then `pnpm test` (full tsc + suite) — no regressions.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/chat/types.ts packages/core/src/chat/config.ts packages/core/src/policy/types.ts packages/core/tests/chat/config.test.ts
git commit -m "feat(chat): chat config schema + resolved defaults"
```

---

### Task 3: Sliding-window rate limiter with disarm/rearm

**Files:**
- Create: `packages/core/src/chat/ratelimit.ts`
- Test: `packages/core/tests/chat/ratelimit.test.ts`

**Interfaces:**
- Produces:

```ts
export class SlidingWindowLimiter {
  constructor(opts: { limit: number; windowMs: number; now?: () => number });
  tryAcquire(): boolean;      // false when over limit; going over DISARMS the limiter
  get disarmed(): boolean;    // once disarmed, tryAcquire() is false until rearm()
  rearm(): void;              // clears history + disarmed flag
}
```

Semantics (Phase 7 circuit breaker): exceeding the limit doesn't just reject one message — it trips the breaker. Everything is rejected until an explicit `rearm()` from a *different* surface (CLI/web, Task 11), which is what catches a pwned-phone flood.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/chat/ratelimit.test.ts
import { describe, it, expect } from "vitest";
import { SlidingWindowLimiter } from "../../src/chat/ratelimit.js";

describe("SlidingWindowLimiter", () => {
  it("allows up to limit within the window, then disarms", () => {
    let t = 0;
    const l = new SlidingWindowLimiter({ limit: 3, windowMs: 1000, now: () => t });
    expect(l.tryAcquire()).toBe(true);
    expect(l.tryAcquire()).toBe(true);
    expect(l.tryAcquire()).toBe(true);
    expect(l.tryAcquire()).toBe(false); // 4th trips the breaker
    expect(l.disarmed).toBe(true);
  });

  it("stays disarmed even after the window passes, until rearm()", () => {
    let t = 0;
    const l = new SlidingWindowLimiter({ limit: 1, windowMs: 1000, now: () => t });
    l.tryAcquire();
    l.tryAcquire(); // trips
    t = 10_000;     // window long gone
    expect(l.tryAcquire()).toBe(false);
    l.rearm();
    expect(l.disarmed).toBe(false);
    expect(l.tryAcquire()).toBe(true);
  });

  it("evicts entries older than the window before counting", () => {
    let t = 0;
    const l = new SlidingWindowLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect(l.tryAcquire()).toBe(true); // t=0
    t = 600;
    expect(l.tryAcquire()).toBe(true); // t=600
    t = 1100;                          // first entry expired
    expect(l.tryAcquire()).toBe(true); // still within limit
    expect(l.disarmed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/chat/ratelimit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/chat/ratelimit.ts
/**
 * Sliding-window rate limiter that behaves like a circuit breaker: exceeding
 * the limit disarms the limiter entirely (everything rejected) until an
 * explicit rearm() from a trusted surface. See Phase 7 spec, "Circuit breakers".
 */
export class SlidingWindowLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private stamps: number[] = [];
  private tripped = false;

  constructor(opts: { limit: number; windowMs: number; now?: () => number }) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
  }

  get disarmed(): boolean {
    return this.tripped;
  }

  tryAcquire(): boolean {
    if (this.tripped) return false;
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < this.windowMs);
    if (this.stamps.length >= this.limit) {
      this.tripped = true;
      return false;
    }
    this.stamps.push(t);
    return true;
  }

  rearm(): void {
    this.tripped = false;
    this.stamps = [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/chat/ratelimit.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/chat/ratelimit.ts packages/core/tests/chat/ratelimit.test.ts
git commit -m "feat(chat): sliding-window rate limiter with circuit-breaker disarm"
```

---

### Task 4: FakeGateway test double

An in-process `ws` server speaking the recorded gateway dialect (Task 1 fixtures). Used by Task 5's bridge tests and Task 15's E2E. Reconcile every frame shape below against `tests/chat/fixtures/gateway-frames.json` — the fixture wins over this plan text.

**Files:**
- Create: `packages/core/tests/chat/fake-gateway.ts`
- Test: `packages/core/tests/chat/fake-gateway.test.ts`

**Interfaces:**
- Produces:

```ts
export class FakeGateway {
  constructor(opts?: { requireToken?: string });
  start(port?: number): Promise<number>;    // listens on 127.0.0.1 (random port unless given), returns port
  stop(): Promise<void>;
  get url(): string;                        // ws://127.0.0.1:<port>
  /** Script the reply to the next chat.send: emits deltas then a final. */
  replyWith(chunks: string[], final: string): void;
  get received(): Array<Record<string, unknown>>; // every req frame received
}
```

Behavior: on client connect send `{type:"event",event:"connect.challenge",payload:{nonce:"n",ts:1}}`; on `connect` req — if `requireToken` set and `params.auth?.token` mismatches reply `{type:"res",id,ok:false,error:{message:"unauthorized"}}` and close, else reply hello-ok `{type:"res",id,ok:true,payload:{type:"hello-ok",protocol:4,server:{version:"fake",connId:"c1"},features:{methods:["chat.send"],events:[]},snapshot:{},auth:{role:"operator",scopes:[]},policy:{maxPayload:1048576,maxBufferedBytes:2097152,tickIntervalMs:15000}}}`; on `chat.send` req ack `{type:"res",id,ok:true,payload:{}}` then emit the scripted reply as chat events (exact event name/payload from the fixture — the recorded frames for the streamed reply; if the fixture shows e.g. `{type:"event",event:"chat.update",payload:{sessionKey,delta:{text}}}` use precisely that, with the final message carrying whatever terminal marker the fixture shows).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/chat/fake-gateway.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { FakeGateway } from "./fake-gateway.js";

const collect = (ws: WebSocket) => {
  const frames: any[] = [];
  ws.on("message", (d) => frames.push(JSON.parse(d.toString())));
  return frames;
};
const until = async (pred: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

let gw: FakeGateway;
afterEach(async () => { await gw?.stop(); });

describe("FakeGateway", () => {
  it("challenges, accepts a valid connect, acks chat.send, streams scripted reply", async () => {
    gw = new FakeGateway({ requireToken: "tok" });
    await gw.start();
    gw.replyWith(["Hel", "lo"], "Hello");
    const ws = new WebSocket(gw.url);
    const frames = collect(ws);
    await until(() => frames.some((f) => f.event === "connect.challenge"));
    ws.send(JSON.stringify({ type: "req", id: "1", method: "connect",
      params: { role: "operator", auth: { token: "tok" }, client: { id: "t" } } }));
    await until(() => frames.some((f) => f.type === "res" && f.payload?.type === "hello-ok"));
    ws.send(JSON.stringify({ type: "req", id: "2", method: "chat.send",
      params: { sessionKey: "s", text: "hi", idempotencyKey: "k1" } }));
    await until(() => frames.filter((f) => f.type === "event" && f.event !== "connect.challenge").length >= 3);
    expect(gw.received.some((r) => r.method === "chat.send")).toBe(true);
    ws.close();
  });

  it("rejects a bad token", async () => {
    gw = new FakeGateway({ requireToken: "tok" });
    await gw.start();
    const ws = new WebSocket(gw.url);
    const frames = collect(ws);
    await until(() => frames.some((f) => f.event === "connect.challenge"));
    ws.send(JSON.stringify({ type: "req", id: "1", method: "connect",
      params: { role: "operator", auth: { token: "WRONG" }, client: { id: "t" } } }));
    await until(() => frames.some((f) => f.type === "res" && f.ok === false));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/chat/fake-gateway.test.ts`
Expected: FAIL — `./fake-gateway.js` not found.

- [ ] **Step 3: Implement FakeGateway**

```ts
// packages/core/tests/chat/fake-gateway.ts
// In-process stand-in for the OpenClaw gateway WS control plane. Speaks the
// dialect recorded in fixtures/gateway-frames.json — if this file and the
// fixture disagree, THE FIXTURE IS RIGHT: update this file.
import { WebSocketServer, WebSocket } from "ws";

interface Scripted { chunks: string[]; final: string }

export class FakeGateway {
  private wss?: WebSocketServer;
  private port = 0;
  private scripted: Scripted = { chunks: [], final: "" };
  readonly received: Array<Record<string, unknown>> = [];
  private readonly requireToken?: string;

  constructor(opts?: { requireToken?: string }) {
    this.requireToken = opts?.requireToken;
  }

  get url(): string { return `ws://127.0.0.1:${this.port}`; }

  replyWith(chunks: string[], final: string): void {
    this.scripted = { chunks, final };
  }

  start(port?: number): Promise<number> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ host: "127.0.0.1", port: port ?? 0 }, () => {
        this.port = (this.wss!.address() as { port: number }).port;
        resolve(this.port);
      });
      this.wss.on("connection", (ws) => this.handle(ws));
    });
  }

  private handle(ws: WebSocket): void {
    ws.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "n", ts: 1 } }));
    ws.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;
      this.received.push(frame);
      if (frame.type !== "req") return;
      const params = frame.params as Record<string, unknown> | undefined;
      if (frame.method === "connect") {
        const token = (params?.auth as { token?: string } | undefined)?.token;
        if (this.requireToken && token !== this.requireToken) {
          ws.send(JSON.stringify({ type: "res", id: frame.id, ok: false, error: { message: "unauthorized" } }));
          ws.close();
          return;
        }
        ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: {
          type: "hello-ok", protocol: 4, server: { version: "fake", connId: "c1" },
          features: { methods: ["chat.send"], events: [] }, snapshot: {},
          auth: { role: "operator", scopes: [] },
          policy: { maxPayload: 1048576, maxBufferedBytes: 2097152, tickIntervalMs: 15000 },
        } }));
        return;
      }
      if (frame.method === "chat.send") {
        const sessionKey = (params as { sessionKey?: string })?.sessionKey ?? "s";
        ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: {} }));
        // Streamed reply — event name/shape mirrors the recorded fixture.
        for (const text of this.scripted.chunks) {
          ws.send(JSON.stringify({ type: "event", event: "chat.update",
            payload: { sessionKey, delta: { text } } }));
        }
        ws.send(JSON.stringify({ type: "event", event: "chat.update",
          payload: { sessionKey, message: { role: "assistant", text: this.scripted.final }, done: true } }));
      }
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) return resolve();
      for (const c of this.wss.clients) c.terminate();
      this.wss.close(() => resolve());
    });
  }
}
```

**Reconcile now:** open `fixtures/gateway-frames.json`; if the real streamed-reply frames differ (event name, delta/done field names), change `handle()`'s chat.send branch — and the test's expectations — to match the recording exactly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/chat/fake-gateway.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tests/chat/fake-gateway.ts packages/core/tests/chat/fake-gateway.test.ts
git commit -m "test(chat): FakeGateway WS double speaking the recorded gateway dialect"
```

---

### Task 5: OpenClawBridge

**Files:**
- Create: `packages/core/src/chat/openclaw-bridge.ts`
- Test: `packages/core/tests/chat/openclaw-bridge.test.ts`

**Interfaces:**
- Consumes: `AgentBridge`, `BridgeEvent` from `src/chat/types.js`; `FakeGateway` (tests).
- Produces:

```ts
export interface OpenClawBridgeOptions {
  url: string;
  token?: string;
  sessionKey: string;
  /** Reconnect backoff schedule in ms. Injectable for tests. Default [1000, 2000, 5000, 10000, 30000]. */
  backoffMs?: number[];
}
export class OpenClawBridge implements AgentBridge {
  readonly kind = "openclaw";
  constructor(opts: OpenClawBridgeOptions);
  start(): Promise<void>;   // resolves after first hello-ok (or rejects on auth failure)
  send(text: string): Promise<void>;
  onEvent(cb: (ev: BridgeEvent) => void): () => void;
  stop(): Promise<void>;
  isUp(): boolean;
}
```

Behavior: connect via `ws`; answer `connect.challenge` with the operator `connect` req (same params as the probe script, `client.id: "habena"`); on hello-ok emit `{kind:"connection",state:"up"}` and resolve `start()`. `send()` issues `chat.send` with a fresh `idempotencyKey` (randomUUID) and emits `{kind:"run_state",state:"started"}`. Incoming `chat.update` events for our sessionKey → `{kind:"delta",text}` for delta frames; the done frame → `{kind:"final",text}` + `{kind:"run_state",state:"finished"}`. Socket close/error → `{kind:"connection",state:"down"}` + reconnect with backoff (stop() cancels). Auth-rejected connect → `start()` rejects, no reconnect loop (config is wrong; retrying can't fix it). The token must never appear in any emitted event, error message, or log.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/chat/openclaw-bridge.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { FakeGateway } from "./fake-gateway.js";
import { OpenClawBridge } from "../../src/chat/openclaw-bridge.js";
import type { BridgeEvent } from "../../src/chat/types.js";

const until = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

let gw: FakeGateway;
let bridge: OpenClawBridge;
afterEach(async () => { await bridge?.stop(); await gw?.stop(); });

describe("OpenClawBridge", () => {
  it("connects, sends, and streams deltas + final back as BridgeEvents", async () => {
    gw = new FakeGateway({ requireToken: "tok" });
    await gw.start();
    gw.replyWith(["Hi ", "there"], "Hi there");
    bridge = new OpenClawBridge({ url: gw.url, token: "tok", sessionKey: "habena-chat" });
    const events: BridgeEvent[] = [];
    bridge.onEvent((e) => events.push(e));
    await bridge.start();
    expect(bridge.isUp()).toBe(true);
    await bridge.send("hello");
    await until(() => events.some((e) => e.kind === "final"));
    expect(events.filter((e) => e.kind === "delta").map((e: any) => e.text)).toEqual(["Hi ", "there"]);
    expect(events.find((e) => e.kind === "final")).toMatchObject({ text: "Hi there" });
    expect(events.some((e) => e.kind === "run_state" && (e as any).state === "finished")).toBe(true);
    const sent = gw.received.find((r) => r.method === "chat.send") as any;
    expect(sent.params.sessionKey).toBe("habena-chat");
    expect(sent.params.idempotencyKey).toBeTruthy();
  });

  it("rejects start() on bad token without retry-looping", async () => {
    gw = new FakeGateway({ requireToken: "tok" });
    await gw.start();
    bridge = new OpenClawBridge({ url: gw.url, token: "WRONG", sessionKey: "s", backoffMs: [10] });
    await expect(bridge.start()).rejects.toThrow(/unauthorized/i);
    expect(bridge.isUp()).toBe(false);
  });

  it("emits connection down and reconnects when the gateway drops", async () => {
    gw = new FakeGateway();
    const port = await gw.start();
    bridge = new OpenClawBridge({ url: gw.url, sessionKey: "s", backoffMs: [50, 50, 50] });
    const events: BridgeEvent[] = [];
    bridge.onEvent((e) => events.push(e));
    await bridge.start();
    await gw.stop();
    await until(() => events.some((e) => e.kind === "connection" && (e as any).state === "down"));
    gw = new FakeGateway();
    await gw.start(port); // revive on the same port (FakeGateway.start accepts a fixed port)
    // reconnect lands within a few backoff ticks
    await until(() => bridge.isUp(), 5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/chat/openclaw-bridge.test.ts`
Expected: FAIL — `openclaw-bridge.js` not found.

- [ ] **Step 3: Implement the bridge**

First, make `FakeGateway.start(port?: number)` accept an optional fixed port (change `port: 0` to `port: port ?? 0`) so the reconnect test can revive the gateway on the same port, and simplify the test's revival line to `await gw.start(port)`.

```ts
// packages/core/src/chat/openclaw-bridge.ts
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { AgentBridge, BridgeEvent } from "./types.js";

export interface OpenClawBridgeOptions {
  url: string;
  token?: string;
  sessionKey: string;
  backoffMs?: number[];
}

const DEFAULT_BACKOFF = [1000, 2000, 5000, 10000, 30000];

/**
 * Operator-scoped WS client to the OpenClaw gateway. One session, one run at
 * a time (the manager serializes). SECURITY: opts.token must never reach an
 * emitted event, thrown error, or log line.
 */
export class OpenClawBridge implements AgentBridge {
  readonly kind = "openclaw";
  private ws?: WebSocket;
  private up = false;
  private stopped = false;
  private attempt = 0;
  private listeners = new Set<(ev: BridgeEvent) => void>();
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly opts: OpenClawBridgeOptions) {}

  isUp(): boolean { return this.up; }

  onEvent(cb: (ev: BridgeEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(ev: BridgeEvent): void {
    for (const cb of this.listeners) cb(ev);
  }

  start(): Promise<void> {
    this.stopped = false;
    return this.connect(/* rejectOnAuthFail */ true);
  }

  private connect(initial: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url);
      this.ws = ws;
      let settled = false;

      ws.on("message", (data) => {
        let frame: any;
        try { frame = JSON.parse(data.toString()); } catch { return; }
        if (frame.type === "event" && frame.event === "connect.challenge") {
          ws.send(JSON.stringify({
            type: "req", id: randomUUID(), method: "connect",
            params: {
              minProtocol: 3, maxProtocol: 4,
              client: { id: "habena", version: "0.5.0", platform: process.platform, mode: "operator" },
              role: "operator", scopes: ["operator.read", "operator.write"],
              caps: [], commands: [], permissions: {},
              auth: this.opts.token ? { token: this.opts.token } : undefined,
              locale: "en-US", userAgent: "habena-chat-bridge",
            },
          }));
          return;
        }
        if (frame.type === "res" && frame.payload?.type === "hello-ok") {
          this.up = true;
          this.attempt = 0;
          if (!settled) { settled = true; resolve(); }
          this.emit({ kind: "connection", state: "up" });
          return;
        }
        if (frame.type === "res" && frame.ok === false && !this.up) {
          // Auth/handshake rejection: config problem — do not retry-loop.
          this.stopped = true;
          if (!settled) { settled = true; reject(new Error(`gateway rejected connect: ${frame.error?.message ?? "unauthorized"}`)); }
          return;
        }
        if (frame.type === "event" && frame.event === "chat.update"
            && frame.payload?.sessionKey === this.opts.sessionKey) {
          // Shapes mirror tests/chat/fixtures/gateway-frames.json.
          if (frame.payload.delta?.text) this.emit({ kind: "delta", text: frame.payload.delta.text });
          if (frame.payload.done) {
            this.emit({ kind: "final", text: frame.payload.message?.text ?? "" });
            this.emit({ kind: "run_state", state: "finished" });
          }
        }
      });

      const onDown = () => {
        const wasUp = this.up;
        this.up = false;
        if (wasUp) this.emit({ kind: "connection", state: "down" });
        if (!settled && !initial) { settled = true; resolve(); } // background retries resolve silently
        if (!settled && initial) { settled = true; reject(new Error("gateway connection failed")); }
        this.scheduleReconnect();
      };
      ws.on("close", onDown);
      ws.on("error", () => { /* close follows; error handled there */ });
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const backoff = this.opts.backoffMs ?? DEFAULT_BACKOFF;
    const delay = backoff[Math.min(this.attempt, backoff.length - 1)];
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      void this.connect(false).catch(() => { /* scheduleReconnect already queued by onDown */ });
    }, delay);
  }

  async send(text: string): Promise<void> {
    if (!this.up || !this.ws) throw new Error("bridge is offline");
    this.emit({ kind: "run_state", state: "started" });
    this.ws.send(JSON.stringify({
      type: "req", id: randomUUID(), method: "chat.send",
      params: { sessionKey: this.opts.sessionKey, text, idempotencyKey: randomUUID() },
    }));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.up = false;
    this.ws?.terminate();
  }
}
```

**Reconcile with the fixture:** if `gateway-frames.json` shows different event names or payload fields for the streamed reply (or shows the handshake demanding a `device` block), update the bridge, the FakeGateway, and both test files together so all three match the recording.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/chat/openclaw-bridge.test.ts tests/chat/fake-gateway.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/chat/openclaw-bridge.ts packages/core/tests/chat/openclaw-bridge.test.ts packages/core/tests/chat/fake-gateway.ts packages/core/tests/chat/fake-gateway.test.ts
git commit -m "feat(chat): OpenClaw gateway bridge (WS operator client, reconnect, streaming)"
```

---

### Task 6: ChatChannelManager

**Files:**
- Create: `packages/core/src/chat/manager.ts`
- Test: `packages/core/tests/chat/manager.test.ts`

**Interfaces:**
- Consumes: `AgentBridge`, `BridgeEvent`, `ChatEvent`, `InboundChatMessage`, `ChatChannelId` (Task 2); `SlidingWindowLimiter` (Task 3).
- Produces:

```ts
export interface ChatAuditHook {
  (entry: { channel: ChatChannelId; sender: string; text: string; accepted: boolean; reason?: string }): void;
}
export interface ChatManagerOptions {
  bridge: AgentBridge;
  /** Per-channel limits; channels absent here are unlimited (web default). */
  limits?: Partial<Record<ChatChannelId, { limit: number; windowMs: number }>>;
  onAudit?: ChatAuditHook;
  historySize?: number;        // default 200 events
  queueDepth?: number;         // default 5 pending commands
  now?: () => Date;
}
export class ChatChannelManager {
  constructor(opts: ChatManagerOptions);
  handleInbound(msg: InboundChatMessage): { accepted: boolean; reason?: string };
  subscribe(cb: (ev: ChatEvent) => void): () => void;
  history(limit?: number): ChatEvent[];
  activeChannel(): ChatChannelId | null;   // channel of the currently running command
  status(): { bridgeUp: boolean; running: boolean; disarmed: ChatChannelId[]; queueDepth: number };
  rearm(channel: ChatChannelId): void;
}
```

Behavior:
- `handleInbound`: empty/whitespace text → reject `"empty"`. Disarmed or over-limit channel → reject `"rate_limited"` + emit `rejected` event. Bridge down → reject `"offline"` + emit `status offline`. Queue full → reject `"busy"`. Otherwise: emit `user` event, enqueue; if idle, dispatch immediately (`bridge.send`), setting `activeChannel` to the message's channel until the bridge reports `run_state finished|error`, then dispatch the next queued command (whose channel becomes active). Every inbound (accepted or not) calls `onAudit`.
- Bridge events map to chat events: `delta` → `assistant_delta`; `final` → `assistant_final`; `run_state finished|error` → clears active channel, emits `status idle` (or `status offline` with `detail` on error), drains queue; `connection down` → `status offline`; `connection up` → `status idle`.
- All emitted events are appended to a bounded history ring (drop oldest past `historySize`) and fanned to subscribers; subscriber callbacks that throw must not break the fan-out.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/chat/manager.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { ChatChannelManager } from "../../src/chat/manager.js";
import type { AgentBridge, BridgeEvent, ChatEvent } from "../../src/chat/types.js";

/** Hand-cranked bridge double: tests drive replies via emit(). */
class StubBridge implements AgentBridge {
  readonly kind = "stub";
  up = true;
  sent: string[] = [];
  private cbs = new Set<(ev: BridgeEvent) => void>();
  async start() {}
  async stop() {}
  isUp() { return this.up; }
  onEvent(cb: (ev: BridgeEvent) => void) { this.cbs.add(cb); return () => this.cbs.delete(cb); }
  emit(ev: BridgeEvent) { for (const cb of this.cbs) cb(ev); }
  async send(text: string) { this.sent.push(text); this.emit({ kind: "run_state", state: "started" }); }
}

let bridge: StubBridge;
let events: ChatEvent[];
let audits: any[];
let mgr: ChatChannelManager;

beforeEach(() => {
  bridge = new StubBridge();
  events = [];
  audits = [];
  mgr = new ChatChannelManager({
    bridge,
    limits: { telegram: { limit: 2, windowMs: 600_000 } },
    onAudit: (e) => audits.push(e),
    now: () => new Date("2026-07-05T00:00:00Z"),
  });
  mgr.subscribe((e) => events.push(e));
});

const finish = () => { bridge.emit({ kind: "final", text: "done" }); bridge.emit({ kind: "run_state", state: "finished" }); };

describe("ChatChannelManager", () => {
  it("accepts a web message, forwards to bridge, streams reply, returns to idle", () => {
    const res = mgr.handleInbound({ channel: "web", sender: "local", text: "hi" });
    expect(res.accepted).toBe(true);
    expect(bridge.sent).toEqual(["hi"]);
    expect(mgr.activeChannel()).toBe("web");
    bridge.emit({ kind: "delta", text: "do" });
    finish();
    expect(mgr.activeChannel()).toBeNull();
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("user");
    expect(kinds).toContain("assistant_delta");
    expect(kinds).toContain("assistant_final");
    expect(audits).toEqual([{ channel: "web", sender: "local", text: "hi", accepted: true }]);
  });

  it("queues while running, then dispatches FIFO with correct active channel", () => {
    mgr.handleInbound({ channel: "web", sender: "local", text: "first" });
    const res2 = mgr.handleInbound({ channel: "telegram", sender: "42", text: "second" });
    expect(res2.accepted).toBe(true);
    expect(bridge.sent).toEqual(["first"]); // second waits
    finish();
    expect(bridge.sent).toEqual(["first", "second"]);
    expect(mgr.activeChannel()).toBe("telegram");
  });

  it("trips the telegram breaker and rejects until rearm", () => {
    mgr.handleInbound({ channel: "telegram", sender: "42", text: "1" }); finish();
    mgr.handleInbound({ channel: "telegram", sender: "42", text: "2" }); finish();
    const res = mgr.handleInbound({ channel: "telegram", sender: "42", text: "3" });
    expect(res).toEqual({ accepted: false, reason: "rate_limited" });
    expect(mgr.status().disarmed).toEqual(["telegram"]);
    expect(events.some((e) => e.kind === "rejected")).toBe(true);
    // web is unaffected
    expect(mgr.handleInbound({ channel: "web", sender: "local", text: "ok" }).accepted).toBe(true);
    finish();
    mgr.rearm("telegram");
    expect(mgr.handleInbound({ channel: "telegram", sender: "42", text: "4" }).accepted).toBe(true);
  });

  it("rejects when the bridge is down", () => {
    bridge.up = false;
    expect(mgr.handleInbound({ channel: "web", sender: "local", text: "hi" }))
      .toEqual({ accepted: false, reason: "offline" });
    expect(audits.at(-1)).toMatchObject({ accepted: false, reason: "offline" });
  });

  it("bounds history and rejects when the queue is full", () => {
    const small = new ChatChannelManager({ bridge, historySize: 3, queueDepth: 1 });
    small.handleInbound({ channel: "web", sender: "local", text: "a" }); // running
    expect(small.handleInbound({ channel: "web", sender: "local", text: "b" }).accepted).toBe(true); // queued
    expect(small.handleInbound({ channel: "web", sender: "local", text: "c" }))
      .toEqual({ accepted: false, reason: "busy" });
    expect(small.history().length).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/chat/manager.test.ts`
Expected: FAIL — `manager.js` not found.

- [ ] **Step 3: Implement the manager**

```ts
// packages/core/src/chat/manager.ts
import type { AgentBridge, ChatChannelId, ChatEvent, InboundChatMessage } from "./types.js";
import { SlidingWindowLimiter } from "./ratelimit.js";

export interface ChatAuditHook {
  (entry: { channel: ChatChannelId; sender: string; text: string; accepted: boolean; reason?: string }): void;
}

export interface ChatManagerOptions {
  bridge: AgentBridge;
  limits?: Partial<Record<ChatChannelId, { limit: number; windowMs: number }>>;
  onAudit?: ChatAuditHook;
  historySize?: number;
  queueDepth?: number;
  now?: () => Date;
}

/**
 * Routes inbound human messages to the agent bridge — one run at a time —
 * and fans the agent's reply stream out to subscribers (IPC, Telegram).
 * Enforces per-channel circuit-breaker rate limits. Tracks which channel
 * originated the ACTIVE run so the proxy can apply a channel policy floor.
 * INVARIANT: nothing in here mutates policy or config.
 */
export class ChatChannelManager {
  private readonly bridge: AgentBridge;
  private readonly limiters = new Map<ChatChannelId, SlidingWindowLimiter>();
  private readonly onAudit?: ChatAuditHook;
  private readonly historySize: number;
  private readonly queueDepth: number;
  private readonly now: () => Date;
  private readonly subscribers = new Set<(ev: ChatEvent) => void>();
  private readonly ring: ChatEvent[] = [];
  private readonly queue: InboundChatMessage[] = [];
  private active: ChatChannelId | null = null;

  constructor(opts: ChatManagerOptions) {
    this.bridge = opts.bridge;
    this.onAudit = opts.onAudit;
    this.historySize = opts.historySize ?? 200;
    this.queueDepth = opts.queueDepth ?? 5;
    this.now = opts.now ?? (() => new Date());
    for (const [channel, l] of Object.entries(opts.limits ?? {})) {
      if (l) this.limiters.set(channel as ChatChannelId, new SlidingWindowLimiter({ limit: l.limit, windowMs: l.windowMs, now: () => this.now().getTime() }));
    }
    this.bridge.onEvent((ev) => {
      const at = this.now().toISOString();
      if (ev.kind === "delta") this.emit({ kind: "assistant_delta", text: ev.text, at });
      else if (ev.kind === "final") this.emit({ kind: "assistant_final", text: ev.text, at });
      else if (ev.kind === "run_state" && (ev.state === "finished" || ev.state === "error")) {
        this.active = null;
        this.emit(ev.state === "error"
          ? { kind: "status", state: "offline", detail: ev.detail, at }
          : { kind: "status", state: "idle", at });
        this.drain();
      } else if (ev.kind === "connection") {
        this.emit({ kind: "status", state: ev.state === "up" ? "idle" : "offline", at });
      }
    });
  }

  subscribe(cb: (ev: ChatEvent) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private emit(ev: ChatEvent): void {
    this.ring.push(ev);
    while (this.ring.length > this.historySize) this.ring.shift();
    for (const cb of this.subscribers) {
      try { cb(ev); } catch { /* one bad subscriber must not break fan-out */ }
    }
  }

  history(limit?: number): ChatEvent[] {
    return limit ? this.ring.slice(-limit) : [...this.ring];
  }

  activeChannel(): ChatChannelId | null { return this.active; }

  status(): { bridgeUp: boolean; running: boolean; disarmed: ChatChannelId[]; queueDepth: number } {
    return {
      bridgeUp: this.bridge.isUp(),
      running: this.active !== null,
      disarmed: [...this.limiters.entries()].filter(([, l]) => l.disarmed).map(([c]) => c),
      queueDepth: this.queue.length,
    };
  }

  rearm(channel: ChatChannelId): void {
    this.limiters.get(channel)?.rearm();
  }

  handleInbound(msg: InboundChatMessage): { accepted: boolean; reason?: string } {
    const at = this.now().toISOString();
    const reject = (reason: string) => {
      this.onAudit?.({ channel: msg.channel, sender: msg.sender, text: msg.text, accepted: false, reason });
      this.emit({ kind: "rejected", channel: msg.channel, reason, at });
      return { accepted: false, reason };
    };
    if (!msg.text.trim()) return reject("empty");
    const limiter = this.limiters.get(msg.channel);
    if (limiter && !limiter.tryAcquire()) return reject("rate_limited");
    if (!this.bridge.isUp()) return reject("offline");
    if (this.queue.length >= this.queueDepth && this.active !== null) return reject("busy");
    this.onAudit?.({ channel: msg.channel, sender: msg.sender, text: msg.text, accepted: true });
    this.emit({ kind: "user", channel: msg.channel, text: msg.text, at });
    this.queue.push(msg);
    if (this.active === null) this.drain();
    return { accepted: true };
  }

  private drain(): void {
    const next = this.queue.shift();
    if (!next) return;
    this.active = next.channel;
    this.emit({ kind: "status", state: "running", channel: next.channel, at: this.now().toISOString() });
    void this.bridge.send(next.text).catch(() => {
      this.active = null;
      this.emit({ kind: "status", state: "offline", detail: "send failed", at: this.now().toISOString() });
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/chat/manager.test.ts`
Expected: 5 passed. Then full `pnpm test` — no regressions.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/chat/manager.ts packages/core/tests/chat/manager.test.ts
git commit -m "feat(chat): ChatChannelManager — routing, serialization, rate limits, fan-out"
```

---

### Task 7: Telegram channel policy floor in the proxy

While a Telegram-originated run is active, the proxy merges the normal decision with a floor decision (stricter-of-two, exactly like the existing host-policy floor) evaluated by a second `PolicyEngine` built from a preset (default `cautious`). Approvals created during such a run are tagged `origin: "telegram"`.

**Files:**
- Modify: `packages/core/src/proxy/server.ts` (decision pipeline ~lines 72–95; deps interface ~line 23)
- Modify: `packages/core/src/approval/types.ts` (add `origin?: "web" | "telegram"` to the approval request type)
- Test: `packages/core/tests/proxy/channel-floor.test.ts`

**Interfaces:**
- Consumes: `stricter(a, b)` and `PolicyEngine` from `src/policy/engine.js`; `getPreset(name)` from `src/policy/presets.js`; `ChatChannelManager.activeChannel()`.
- Produces: new optional proxy dep

```ts
chatFloor?: {
  active(): "web" | "telegram" | null;
  engine: PolicyEngine;   // built from the configured floor preset's rules
}
```

and `PendingApproval.request.origin?: "web" | "telegram"` set from `chatFloor.active()` at approval-creation time.

- [ ] **Step 1: Read the two files, then write the failing test**

Read `src/proxy/server.ts` in full (331 lines) and the existing proxy tests in `tests/proxy/` to copy their harness pattern (how they construct the proxy with stub deps and assert on decisions). Then write, following that local pattern:

```ts
// packages/core/tests/proxy/channel-floor.test.ts  (adapt harness to match existing proxy tests)
import { describe, it, expect } from "vitest";
// ... same imports/stubs the sibling proxy tests use to build the pipeline ...

describe("chat channel policy floor", () => {
  it("keeps the user decision when no chat run is active", () => {
    // engine says allow; chatFloor.active() returns null → decision stays allow
  });

  it("escalates an allow to the floor's require_approval during a telegram run", () => {
    // user policy: allow write_file; floor preset (cautious) says require_approval
    // chatFloor.active() → "telegram"  ⇒ final decision require_approval
  });

  it("web runs do NOT get the floor", () => {
    // chatFloor.active() → "web" ⇒ decision stays allow
  });

  it("tags approvals created during a telegram run with origin", () => {
    // decision require_approval while active() → "telegram"
    // ⇒ the PendingApproval created carries request.origin === "telegram"
  });
});
```

Flesh each test body out with the concrete harness from the sibling tests — same stub deps, same request shape (`agentType`, `instanceId`, `tool`, `args`, `mcpServer`). The four behaviors above are the required assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/proxy/channel-floor.test.ts`
Expected: FAIL — `chatFloor` dep unknown / origin field absent.

- [ ] **Step 3: Implement**

In `src/proxy/server.ts` deps interface add the `chatFloor` block from Interfaces. In the decision pipeline, immediately after the threat merge (~line 95):

```ts
    // Chat channel floor: a phone-originated run never runs looser than the
    // configured floor preset, no matter what the user policy allows.
    if (this.deps.chatFloor?.active() === "telegram") {
      const floorDecision = this.deps.chatFloor.engine.evaluate({
        agentType: req.agentType, instanceId: req.instanceId,
        tool: req.tool, args: req.args, mcpServer: req.mcpServer,
      });
      decision = stricter(decision, floorDecision);
    }
```

(Match the exact `evaluate()` request shape used at line 79 — copy it verbatim.) Where the proxy creates the `PendingApproval` request for a `require_approval` decision, add `origin: this.deps.chatFloor?.active() ?? undefined`. Add `origin?: "web" | "telegram"` to the approval request interface in `src/approval/types.ts`, and thread it through `serializePending()` in `src/ipc/protocol.ts` (add `origin?: string` to `SerializedPendingApproval`) so the web UI and Telegram channel can see it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/proxy/ tests/ipc/`
Expected: new tests pass, all existing proxy/IPC tests still green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/proxy/server.ts packages/core/src/approval/types.ts packages/core/src/ipc/protocol.ts packages/core/tests/proxy/channel-floor.test.ts
git commit -m "feat(chat): telegram policy floor in proxy + approval origin tagging"
```

---

### Task 8: Two-channel confirmation — Telegram can't allow its own approvals

An approval with `origin: "telegram"` must not be *allowed* from Telegram (phone commands, Mac approves — a stolen phone can't both command and approve). Deny stays available from Telegram.

**Files:**
- Modify: `packages/core/src/approval/channels/telegram-format.ts` (prompt keyboard builder)
- Modify: `packages/core/src/approval/channels/telegram.ts` (guard on callback resolution)
- Test: extend `packages/core/tests/approval/telegram-channel.test.ts` and `tests/approval/telegram-format.test.ts`

**Interfaces:**
- Consumes: `SerializedPendingApproval.origin` (Task 7).
- Produces: no new exports — behavioral guarantee only: for `origin === "telegram"` prompts, the inline keyboard contains Deny only, prompt text appends "⚠️ Requested from Telegram — approve from your Mac dashboard.", and (defense in depth) an `allow_once` callback for such an approval is answered "Approve from your Mac" and dropped without reaching `queue.respond()`.

- [ ] **Step 1: Write the failing tests**

In `tests/approval/telegram-format.test.ts` (follow the file's existing test style for `promptText`/keyboard assertions):

```ts
  it("renders a deny-only keyboard and a Mac-approval notice for telegram-origin approvals", () => {
    const pending = { ...basePending, origin: "telegram" };   // reuse the file's existing basePending fixture
    const kb = inlineKeyboard(pending, "token1");             // use the file's actual keyboard-builder name
    const labels = kb.inline_keyboard.flat().map((b) => b.text);
    expect(labels.join(" ")).not.toMatch(/allow/i);
    expect(labels.join(" ")).toMatch(/deny/i);
    expect(promptText(pending)).toMatch(/approve from your Mac/i);
  });
```

In `tests/approval/telegram-channel.test.ts` (reuse its fake `TelegramApi` + hand-driven `pollOnce()` harness):

```ts
  it("refuses an allow_once callback for a telegram-origin approval", async () => {
    // enqueue approval with origin "telegram", deliver prompt, then simulate the
    // owner tapping a forged allow_once callback for its token.
    // EXPECT: api answered with /approve from your Mac/i, queue.respond NOT called.
  });
```

Flesh out with the file's existing fixtures/harness (it already has fakes for api + queue).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run tests/approval/telegram-format.test.ts tests/approval/telegram-channel.test.ts`
Expected: new tests FAIL (keyboard still has Allow; callback resolves).

- [ ] **Step 3: Implement**

In `telegram-format.ts`: the keyboard builder takes the serialized pending; when `pending.origin === "telegram"` omit the allow button(s) and keep deny; `promptText` appends the Mac notice line for that case. In `telegram.ts`: in the callback_query handler, after owner auth + `parseCallback`, look up the tracked prompt's approval; if its origin is `"telegram"` and the parsed choice is any allow variant, answer the callback with "Approve from your Mac dashboard" and return WITHOUT consuming the token or calling `queue.respond()` (keep the prompt live so the deny path still works). Track origin on `TrackedPrompt` when the prompt is delivered.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/approval/`
Expected: all pass, including the untouched existing approval tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/approval/channels/telegram-format.ts packages/core/src/approval/channels/telegram.ts packages/core/tests/approval/telegram-format.test.ts packages/core/tests/approval/telegram-channel.test.ts
git commit -m "feat(chat): two-channel confirmation — telegram-origin approvals allow-only from web"
```

---

### Task 9: IPC chat frames

**Files:**
- Modify: `packages/core/src/ipc/protocol.ts`
- Modify: `packages/core/src/ipc/server.ts`
- Test: `packages/core/tests/ipc/chat-frames.test.ts`

**Interfaces:**
- Consumes: `ChatChannelManager` (Task 6), `ChatEvent`, `ChatChannelId` (Task 2).
- Produces — additions to the protocol unions (exact shapes; web's protocol copy in Task 12 must match verbatim):

```ts
// ClientMessage additions
| { type: "chat_send"; text: string }                       // IPC is local-only ⇒ always channel "web"
| { type: "chat_subscribe" }
| { type: "chat_history"; limit?: number }
| { type: "chat_status" }
| { type: "chat_rearm"; channel: "web" | "telegram" }

// ServerMessage additions
| { type: "chat_ack"; ok: boolean; reason?: string }
| { type: "chat_event"; event: ChatEvent }
| { type: "chat_history_result"; events: ChatEvent[] }
| { type: "chat_status_result"; bridgeUp: boolean; running: boolean; disarmed: string[]; queueDepth: number }
```

Server behavior: the IPC server takes an optional `chat?: ChatChannelManager` dep. `chat_send` → `manager.handleInbound({channel:"web", sender:"local", text})` → `chat_ack`. `chat_subscribe` → subscribe that connection; forward every `ChatEvent` as `chat_event` until the connection closes (unsubscribe on close — no leaks). `chat_history`/`chat_status`/`chat_rearm` map 1:1 to manager methods. All five frames answered with `{"type":"error","message":"chat disabled"}` when no manager is configured.

- [ ] **Step 1: Write the failing test**

Read `tests/ipc/` first and reuse its harness (how existing tests start `IpcServer` on a temp socket path and drive a raw `net` client with `encode`/`decodeLines`). Then:

```ts
// packages/core/tests/ipc/chat-frames.test.ts — adapt setup to the sibling ipc tests' harness
describe("IPC chat frames", () => {
  it("chat_send routes to the manager as channel web and acks", async () => {
    // send {type:"chat_send",text:"hi"} → expect {type:"chat_ack",ok:true}
    // manager stub records handleInbound({channel:"web",sender:"local",text:"hi"})
  });
  it("chat_subscribe streams manager events and unsubscribes on disconnect", async () => {
    // subscribe, manager emits an assistant_delta → client receives chat_event;
    // close client, emit again → subscriber count back to 0 (expose via stub)
  });
  it("chat_history / chat_status / chat_rearm map to manager methods", async () => {});
  it("all chat frames error cleanly when chat is disabled", async () => {
    // server constructed without chat dep → {type:"error",message:"chat disabled"}
  });
});
```

Use a minimal manager stub (same spirit as `StubBridge` in Task 6) rather than a real manager.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/ipc/chat-frames.test.ts`
Expected: FAIL — unknown message types.

- [ ] **Step 3: Implement**

Add the unions to `protocol.ts` (import `ChatEvent` type from `../chat/types.js`). In `server.ts`: accept `chat` in the server's deps/options; extend the message dispatch switch with the five cases; keep a per-connection unsubscribe function and call it in the existing connection-close cleanup path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/ipc/`
Expected: all pass including existing IPC tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ipc/protocol.ts packages/core/src/ipc/server.ts packages/core/tests/ipc/chat-frames.test.ts
git commit -m "feat(chat): IPC chat frames — send/subscribe/history/status/rearm"
```

---

### Task 10: Wire chat into `habena start` + Telegram inbound binding

**Files:**
- Create: `packages/core/src/chat/telegram-binding.ts`
- Modify: `packages/core/src/cli/commands/start.ts` (channel wiring section, ~lines 140–170)
- Modify: `packages/core/src/approval/channels/telegram.ts` (add `onChatMessage` option)
- Test: `packages/core/tests/chat/telegram-binding.test.ts`, extend `tests/approval/telegram-channel.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:

```ts
// src/chat/telegram-binding.ts
export interface TelegramChatBindingOptions {
  manager: ChatChannelManager;
  send: (text: string) => Promise<void>;  // start.ts passes api.sendMessage(ownerId, ...)
  ownerId: string | number;
}
export class TelegramChatBinding {
  constructor(opts: TelegramChatBindingOptions);
  /** Wire into TelegramApprovalChannel's onChatMessage hook. */
  handleMessage(text: string): void;
  start(): void;  // subscribes to manager events
  stop(): void;   // unsubscribes
}
```

New option on `TelegramApprovalChannelOptions`: `onChatMessage?: (text: string) => void` — called for owner plain-text messages that are NOT slash-commands (owner auth already enforced before the existing `onCommand` path; non-owner messages never reach either hook).

Binding behavior: `handleMessage(text)` → `manager.handleInbound({channel:"telegram", sender:String(ownerId), text})`; if rejected, immediately `send()` a human reason ("⏳ Rate limit tripped — run `habena chat rearm telegram` or use the dashboard." / "Assistant is offline." / "Busy — try again in a moment."). On manager events: `assistant_final` while the *event stream's* originating channel was telegram (track: binding remembers whether the currently running command came from telegram by watching `user` events) → `send(text)`. `rejected`/`status offline` events for telegram-originated messages already handled at inbound time — don't double-send.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/tests/chat/telegram-binding.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { TelegramChatBinding } from "../../src/chat/telegram-binding.js";
import { ChatChannelManager } from "../../src/chat/manager.js";
import type { AgentBridge, BridgeEvent } from "../../src/chat/types.js";

class StubBridge implements AgentBridge {           // same double as manager.test.ts
  readonly kind = "stub"; up = true; sent: string[] = [];
  private cbs = new Set<(ev: BridgeEvent) => void>();
  async start() {} async stop() {} isUp() { return this.up; }
  onEvent(cb: (ev: BridgeEvent) => void) { this.cbs.add(cb); return () => this.cbs.delete(cb); }
  emit(ev: BridgeEvent) { for (const cb of this.cbs) cb(ev); }
  async send(text: string) { this.sent.push(text); }
}

let bridge: StubBridge; let mgr: ChatChannelManager; let sent: string[]; let binding: TelegramChatBinding;
beforeEach(() => {
  bridge = new StubBridge();
  mgr = new ChatChannelManager({ bridge });
  sent = [];
  binding = new TelegramChatBinding({ manager: mgr, ownerId: 42, send: async (t) => { sent.push(t); } });
  binding.start();
});

describe("TelegramChatBinding", () => {
  it("routes owner text to the manager and returns the final reply to telegram", () => {
    binding.handleMessage("what is on my calendar?");
    expect(bridge.sent).toEqual(["what is on my calendar?"]);
    bridge.emit({ kind: "final", text: "Two meetings." });
    bridge.emit({ kind: "run_state", state: "finished" });
    expect(sent).toEqual(["Two meetings."]);
  });

  it("does not send web-originated replies to telegram", () => {
    mgr.handleInbound({ channel: "web", sender: "local", text: "hi" });
    bridge.emit({ kind: "final", text: "web answer" });
    bridge.emit({ kind: "run_state", state: "finished" });
    expect(sent).toEqual([]);
  });

  it("sends a human-readable rejection when the bridge is offline", () => {
    bridge.up = false;
    binding.handleMessage("hello?");
    expect(sent.some((t) => /offline/i.test(t))).toBe(true);
  });
});
```

Plus in `tests/approval/telegram-channel.test.ts`: a test that an owner plain-text (non-slash) message invokes `onChatMessage("...")`, a non-owner message does not, and a `/status`-style command still goes to `onCommand` only.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run tests/chat/telegram-binding.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`telegram-binding.ts`:

```ts
import type { ChatChannelManager } from "./manager.js";
import type { ChatEvent } from "./types.js";

export interface TelegramChatBindingOptions {
  manager: ChatChannelManager;
  send: (text: string) => Promise<void>;
  ownerId: string | number;
}

const REJECTION_TEXT: Record<string, string> = {
  rate_limited: "⏳ Rate limit tripped for Telegram. Re-arm from the dashboard or `habena chat rearm telegram`.",
  offline: "🔌 Your assistant is offline right now.",
  busy: "⏱ Busy with another request — try again in a moment.",
  empty: "Send some text to talk to your assistant.",
};

/** Glue between the Telegram approval channel's inbound hook and the chat manager. */
export class TelegramChatBinding {
  private unsubscribe?: () => void;
  private telegramRunActive = false;

  constructor(private readonly opts: TelegramChatBindingOptions) {}

  start(): void {
    this.unsubscribe = this.opts.manager.subscribe((ev: ChatEvent) => {
      if (ev.kind === "status" && ev.state === "running") this.telegramRunActive = ev.channel === "telegram";
      if (ev.kind === "assistant_final" && this.telegramRunActive) void this.opts.send(ev.text);
    });
  }

  stop(): void { this.unsubscribe?.(); }

  handleMessage(text: string): void {
    const res = this.opts.manager.handleInbound({
      channel: "telegram", sender: String(this.opts.ownerId), text,
    });
    if (!res.accepted) void this.opts.send(REJECTION_TEXT[res.reason ?? ""] ?? "Couldn't accept that message.");
  }
}
```

(Note: the manager emits `status running` with the run's channel — Task 6's `drain()` already does this.)

In `telegram.ts`: add `onChatMessage?: (text: string) => void` to the options; in the update-processing path where owner plain messages currently route slash-commands to `onCommand`, route non-slash text (`!text.startsWith("/")`) to `onChatMessage` instead — after the existing owner check, never before.

In `start.ts`, after the existing Telegram channel construction (~line 157): resolve chat config; when enabled, build `OpenClawBridge` + `ChatChannelManager` (limits: `{telegram: {limit: telegram.commandsPer10Min, windowMs: 600_000}}` only when telegram inbound is on), `onAudit` writing an `AuditEntry` via the same `AuditLogger` instance start.ts already owns:

```ts
onAudit: (e) => audit.log({
  timestamp: new Date(), agentType: "chat", instanceId: e.channel, tool: "chat.command",
  args: { text: e.text }, mcpServer: "habena-chat",
  decision: e.accepted ? "allow" : "deny", tier: "user",
  reason: e.reason, cost: null, latencyMs: null, resultStatus: e.accepted ? "success" : "error",
}),
```

Build the floor engine (`getPreset(resolved.telegram.policyFloor)` → construct a `PolicyEngine` from its rules the same way start.ts builds the main engine) and pass `chatFloor: { active: () => manager.activeChannel(), engine: floorEngine }` into the proxy deps. Pass `chat: manager` into the IPC server options. When telegram inbound is on and the Telegram channel exists, create the binding with `send: (t) => api.sendMessage(String(telegramCfg.owner_id), t)` (check `TelegramApi`'s actual send method name and mirror it) and pass `onChatMessage: (t) => binding.handleMessage(t)` into the channel options; start/stop the binding alongside the channel. Bridge start failures must NOT kill the proxy: `bridge.start().catch((err) => log warn "chat bridge offline: " + err.message)` — chat degrades to offline, tool proxying is unaffected.

- [ ] **Step 4: Run tests + boot smoke**

Run: `cd packages/core && pnpm test`
Expected: all green.
Then a manual boot check on the VM (config with `chat.enabled: true`, gateway token set): `habena start` in one terminal — log shows chat bridge up; no crash when the gateway is stopped (chat goes offline, proxy keeps serving).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/chat/telegram-binding.ts packages/core/src/cli/commands/start.ts packages/core/src/approval/channels/telegram.ts packages/core/tests/chat/telegram-binding.test.ts packages/core/tests/approval/telegram-channel.test.ts
git commit -m "feat(chat): wire bridge+manager into start; telegram inbound binding"
```

---

### Task 11: CLI — `habena chat status|rearm`

**Files:**
- Create: `packages/core/src/cli/commands/chat.ts`
- Modify: `packages/core/src/cli/index.ts` (register the command; mirror how `approvals.ts` registers)
- Test: `packages/core/tests/cli/chat-command.test.ts`

**Interfaces:**
- Consumes: IPC client (`src/ipc/client.ts`) with the Task 9 frames.
- Produces: `habena chat status` (prints bridge/run/disarmed/queue state), `habena chat rearm telegram` (re-arms the breaker — the "distinct action from a different surface" the Phase 7 spec requires).

- [ ] **Step 1: Write the failing test**

Read `tests/cli/` for the existing command-test pattern (the repo's cli-smoke / command tests) and `src/cli/commands/approvals.ts` for how a command talks IPC. Test: with a stub IPC server on a temp socket that answers `chat_status` with a canned `chat_status_result` and records `chat_rearm`, invoke the command handlers and assert (a) status output contains "bridge: up", "telegram: DISARMED", (b) rearm sends `{type:"chat_rearm",channel:"telegram"}` and prints confirmation, (c) both fail with a clear message when the proxy isn't running (connection refused → "Is `habena start` running?" — mirror the existing approvals command's wording).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/cli/chat-command.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`chat.ts` exports a `registerChatCommand(program: Command)` following the shape of `approvals.ts` (subcommands `status` and `rearm <channel>`, channel validated against `["web","telegram"]`). Register in `cli/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && pnpm test`
Expected: green, including cli-smoke.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli/commands/chat.ts packages/core/src/cli/index.ts packages/core/tests/cli/chat-command.test.ts
git commit -m "feat(cli): habena chat status/rearm"
```

---

### Task 12: Web — chat IPC client + protocol frames

**Files:**
- Modify: `packages/web/src/lib/approval-protocol.ts` (add the Task 9 chat frames — copy verbatim from core's `protocol.ts`)
- Create: `packages/web/src/lib/chat-ipc.ts`
- Test: `packages/web/src/lib/chat-ipc.test.ts`

**Interfaces:**
- Consumes: web's existing socket-path + connection helpers in `approval-ipc.ts` (mirror them exactly — same socket discovery, same NDJSON framing).
- Produces:

```ts
export async function chatSend(text: string): Promise<{ ok: boolean; reason?: string }>;
export async function chatHistory(limit?: number): Promise<ChatEventWire[]>;
export async function chatStatus(): Promise<{ bridgeUp: boolean; running: boolean; disarmed: string[]; queueDepth: number }>;
export async function chatRearm(channel: "web" | "telegram"): Promise<{ ok: boolean }>;
/** Long-lived subscription; returns a close function. */
export function chatSubscribe(onEvent: (ev: ChatEventWire) => void, onError: (err: Error) => void): () => void;
```

where `ChatEventWire` is the `ChatEvent` union re-declared in `approval-protocol.ts`.

- [ ] **Step 1: Write the failing test**

Read `packages/web/src/lib/approval-ipc.test.ts` and reuse its fake-socket-server harness. Cover: `chatSend` happy path (ack ok), `chatSend` when proxy is down (rejects with a typed error), `chatSubscribe` receives two events then close() ends the connection, `chatHistory` returns the events array.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run src/lib/chat-ipc.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Mirror `approval-ipc.ts`'s connect/encode/decode helpers; one-shot helpers open a connection, send the frame, await the matching response type, close. `chatSubscribe` keeps the socket open, sends `chat_subscribe`, and forwards every `chat_event`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web && npx vitest run src/lib/`
Expected: green (existing lib tests too).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/approval-protocol.ts packages/web/src/lib/chat-ipc.ts packages/web/src/lib/chat-ipc.test.ts
git commit -m "feat(web): chat IPC client + protocol frames"
```

---

### Task 13: Web — chat API routes (send / history / SSE stream / status+rearm)

**Files:**
- Create: `packages/web/src/app/api/chat/send/route.ts` + `route.test.ts`
- Create: `packages/web/src/app/api/chat/history/route.ts` + `route.test.ts`
- Create: `packages/web/src/app/api/chat/stream/route.ts` (SSE; covered by E2E-style test)
- Create: `packages/web/src/app/api/chat/status/route.ts` + `route.test.ts` (GET status, POST `{rearm: channel}`)

**Interfaces:**
- Consumes: Task 12 lib functions.
- Produces HTTP API for the page: `POST /api/chat/send {text}` → `{ok, reason?}` (400 on missing/empty text, 502 with `{ok:false, reason:"offline"}` when IPC is unreachable); `GET /api/chat/history?limit=50` → `{events}`; `GET /api/chat/stream` → `text/event-stream` of `data: <ChatEventWire JSON>\n\n`; `GET /api/chat/status` → status JSON; `POST /api/chat/status {rearm:"telegram"}` → `{ok}`.

- [ ] **Step 1: Write the failing route tests**

Follow the existing colocated pattern in `src/app/api/approvals/route.test.ts` (how it mocks the ipc lib with `vi.mock` and invokes the route handlers with `Request` objects). Cover per route: happy path, bad input (400), proxy-down (502). For the SSE route, test that the returned `Response` has `content-type: text/event-stream` and that events pushed by the mocked `chatSubscribe` appear in the streamed body (read one chunk from `res.body!.getReader()`), and that cancelling the reader calls the subscription's close function.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/web && npx vitest run src/app/api/chat/`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Implement the routes**

`send`, `history`, `status` are thin JSON wrappers over the lib. `stream`:

```ts
// packages/web/src/app/api/chat/stream/route.ts
import { chatSubscribe } from "../../../../lib/chat-ipc.js";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();
  let close: (() => void) | undefined;
  const stream = new ReadableStream({
    start(controller) {
      close = chatSubscribe(
        (ev) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`)),
        () => { try { controller.close(); } catch { /* already closed */ } },
      );
    },
    cancel() { close?.(); },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
}
```

(Adjust the relative import depth/style to match sibling routes.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web && npx vitest run src/app/api/chat/ && pnpm build`
Expected: tests green; Next build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/chat/
git commit -m "feat(web): chat API routes — send, history, SSE stream, status/rearm"
```

---

### Task 14: Web — chat page UI

**Files:**
- Create: `packages/web/src/app/chat/page.tsx`
- Create: `packages/web/src/components/chat/ChatPanel.tsx` (client component)
- Test: `packages/web/src/app/chat/page.test.tsx`
- Modify: the app shell's nav (find where existing pages like `approvals` register a sidebar/nav link — `src/components/` app shell — and add "Chat")

**Interfaces:**
- Consumes: Task 13 HTTP API; existing approvals API (`GET /api/approvals`, `POST /api/approvals/respond`) for inline approval cards.
- Produces: `/chat` page — message list (user right / assistant left), streaming assistant text (deltas appended live), composer (Enter sends, disabled with an "Assistant offline" banner when status says `bridgeUp: false` / SSE says `status offline`), inline approval card when a pending approval arrives during a run (poll `GET /api/approvals` every 3s while a run is active; card shows tool + args summary + Allow-once/Deny buttons wired to the existing respond endpoint; approvals with `origin: "telegram"` render Deny + "Approve from your Mac" note — on this page the user IS on the Mac, so show Allow too when `origin` is `"web"` or unset, and for `"telegram"`-origin show both since the dashboard is the designated approval surface).

Functional now, styled minimally with the dashboard's existing design tokens; guided-mode visual polish is sub-project 2.

- [ ] **Step 1: Write the failing page test**

Follow `src/app/page.test.tsx`'s pattern (React Testing Library + mocked fetch/EventSource). Cover: renders history on load; a `user` + `assistant_delta` + `assistant_final` SSE sequence produces a user bubble and a progressively-growing assistant bubble; composer POSTs to `/api/chat/send` and clears; offline status disables the composer and shows the banner; a pending approval during a run renders the card and Deny POSTs to `/api/approvals/respond`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run src/app/chat/`
Expected: FAIL.

- [ ] **Step 3: Implement**

`ChatPanel.tsx` (client): state = `events[]` (seeded from `GET /api/chat/history?limit=100`), `EventSource("/api/chat/stream")` appending events (coalesce `assistant_delta`s into the current streaming bubble; `assistant_final` replaces it), composer with send handler, status banner from `status` events, approval polling effect gated on `running`. `page.tsx` is a thin server component rendering the panel inside the app shell. Add the nav link.

- [ ] **Step 4: Run tests + build**

Run: `cd packages/web && npx vitest run && pnpm build`
Expected: green + clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/chat/ packages/web/src/components/chat/ <nav-file>
git commit -m "feat(web): chat page — streaming conversation + inline approvals"
```

---

### Task 15: End-to-end test, docs, roadmap

**Files:**
- Create: `packages/core/tests/e2e/chat-e2e.test.ts`
- Modify: `README.md` (add a "Talk to your agent" section after the dashboard section)
- Modify: `docs/roadmap.md` (move "Inbound chat commands (Phase 7 V1)" from Next → Done with a summary of what shipped)

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: Write the E2E test**

Follow the harness style in `tests/e2e/` (real components, temp dirs, real sockets). Assemble in-process: `FakeGateway` (scripted reply) → `OpenClawBridge` → `ChatChannelManager` (telegram limit 2) → real `IpcServer` on a temp socket. Drive a raw IPC client:

1. `chat_subscribe` + `chat_send {text:"hello"}` → receives `chat_ack ok`, then `chat_event user`, `assistant_delta`(s), `assistant_final` with the scripted text.
2. Simulate telegram inbound (call `manager.handleInbound({channel:"telegram",...})` three times) → third returns rate_limited; `chat_status` frame reports `disarmed:["telegram"]`; `chat_rearm` clears it.
3. With a stub proxy pipeline (the Task 7 harness) confirm: during a telegram-originated run, a write tool call that user policy allows comes back `require_approval` with `origin:"telegram"`.

- [ ] **Step 2: Run it**

Run: `cd packages/core && npx vitest run tests/e2e/chat-e2e.test.ts`
Expected: PASS (fix whatever integration seam it exposes — that's the point of the task).

- [ ] **Step 3: Full suite both packages**

Run: `cd packages/core && pnpm test && cd ../web && npx vitest run && pnpm build`
Expected: everything green.

- [ ] **Step 4: Update README + roadmap**

README section (after the dashboard block): how to enable (`chat.enabled: true`, `bridge.token_env`, `habena start`), talk from the dashboard `/chat`, enable Telegram inbound (`channels.telegram.inbound: true`) with one paragraph on the safety model: rate-limit breaker + `habena chat rearm telegram`, Telegram floor preset, and "commands from your phone can only be *approved* from your Mac." Roadmap: move the inbound-chat item to Done, dated, listing: OpenClaw bridge, web chat + SSE, Telegram inbound, channel floor, two-channel approval rule, chat CLI.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tests/e2e/chat-e2e.test.ts README.md docs/roadmap.md
git commit -m "feat(chat): e2e coverage + docs — inbound chat channels ship"
```

---

## Manual acceptance (after all tasks, on jarvis-vm)

1. `habena start` with `chat.enabled: true` + real gateway token → dashboard `/chat` → "list the files in my workspace" → streamed reply appears.
2. Ask the agent to *write* a file → approval card appears inline in chat → Deny → agent reports the denial; audit row exists (`habena logs`).
3. From Telegram (inbound on): send "what's in my workspace?" → reply arrives in Telegram. Ask it to delete a file → Telegram prompt has Deny only + "approve from your Mac"; the dashboard can Allow it.
4. Send 11 rapid Telegram messages → breaker trips, bot says so → `habena chat rearm telegram` → flows again.
5. Stop the OpenClaw gateway → chat shows offline, composer disabled; MCP tool proxying still works. Restart gateway → chat recovers without restarting habena.
