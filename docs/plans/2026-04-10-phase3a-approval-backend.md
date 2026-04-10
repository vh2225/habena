# Phase 3a Implementation Plan — Approval Backend

**Goal:** Add a working human-in-the-loop approval system to AgentGuard: approval queue, Unix socket IPC, CLI watcher, and wiring into the proxy dispatcher.

**Architecture:** New `approval/` module holds the queue. New `ipc/` module exposes the queue over a Unix domain socket using newline-delimited JSON. `ProxyDispatcher` awaits the queue when policy returns `require_approval`. New `agentguard watch` CLI command connects to the socket and presents an interactive terminal UI.

**Tech Stack:** TypeScript, Node's built-in `node:net` for Unix sockets, `inquirer` for the watcher UI (already a dep), `uuid` for approval IDs (add as dep).

**Branch:** `phase3a-approvals` (create from main)

---

## File Structure

```
packages/core/src/
├── approval/
│   ├── types.ts           # PendingApproval, ApprovalResponse, messages
│   ├── queue.ts           # ApprovalQueue class (overwrite existing stub)
│   └── timeout.ts         # duration parser (kept from Phase 1 stub)
├── ipc/
│   ├── protocol.ts        # message type union + serialization helpers
│   └── server.ts          # Unix socket server bound to queue events
├── cli/commands/
│   └── watch.ts           # agentguard watch — interactive approval terminal
├── proxy/server.ts        # MODIFY: wire queue into dispatcher
├── policy/types.ts        # MODIFY: extend ApprovalConfig with require_for
├── cli/commands/start.ts  # MODIFY: spawn IPC server, pass queue to dispatcher
└── cli/index.ts           # MODIFY: register watch command

packages/core/tests/
├── approval/
│   └── queue.test.ts
├── ipc/
│   └── server.test.ts
└── e2e/
    └── approval-flow.test.ts   # spawns proxy + mock client
```

---

## Tasks

### Task 1: Branch setup + add dependencies

- [ ] **Step 1:** Create feature branch
  ```bash
  cd /Users/vinh.hoang/github/agentguard
  git checkout main && git pull origin main
  git checkout -b phase3a-approvals
  ```

- [ ] **Step 2:** Add `uuid` dependency in `packages/core/package.json`
  ```json
  "dependencies": {
    ...existing...
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    ...existing...
    "@types/uuid": "^10.0.0"
  }
  ```

- [ ] **Step 3:** Install
  ```bash
  cd packages/core && pnpm install
  ```

- [ ] **Step 4:** Un-exclude `src/approval` from tsconfig. Edit `packages/core/tsconfig.json` and REMOVE the `"src/approval"` line from the `exclude` array.

- [ ] **Step 5:** Verify existing tests still pass
  ```bash
  cd packages/core && pnpm test
  ```
  Expected: 87 tests pass.

- [ ] **Step 6:** Commit
  ```bash
  git add packages/core/package.json packages/core/tsconfig.json packages/core/pnpm-lock.yaml pnpm-lock.yaml 2>/dev/null
  git commit -m "chore(core): add uuid dep and un-exclude src/approval for Phase 3a"
  ```

---

### Task 2: Approval types

**Files:** Overwrite `packages/core/src/approval/types.ts` (Phase 1 excluded this directory; we're now activating it).

- [ ] **Step 1:** Write `packages/core/src/approval/types.ts`:

```ts
import type { PolicyDecision } from "../policy/decisions.js";
import type { ToolCallRequest } from "../proxy/server.js";

export type ApprovalChoice =
  | "allow_once"
  | "allow_session"
  | "deny";

export interface ApprovalResponse {
  choice: ApprovalChoice;
  /** For allow_session: duration in ms to keep the session override alive. */
  durationMs?: number;
  /** Optional free-form note from the user (shown in audit log). */
  note?: string;
}

export interface PendingApproval {
  id: string;
  decision: PolicyDecision;
  request: ToolCallRequest;
  createdAt: Date;
  expiresAt: Date;
}
```

- [ ] **Step 2:** Commit
  ```bash
  git add packages/core/src/approval/types.ts
  git commit -m "feat(approval): add PendingApproval and ApprovalResponse types"
  ```

---

### Task 3: ApprovalQueue class

**Files:**
- Overwrite `packages/core/src/approval/queue.ts`
- Create `packages/core/tests/approval/queue.test.ts`

- [ ] **Step 1:** Write failing tests at `packages/core/tests/approval/queue.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ApprovalQueue } from "../../src/approval/queue.js";
import type { PolicyDecision } from "../../src/policy/decisions.js";
import type { ToolCallRequest } from "../../src/proxy/server.js";

function sampleDecision(): PolicyDecision {
  return {
    action: "require_approval",
    reason: "test",
    tool: "gmail_send",
    enforcement: "soft_mandatory",
    risk_level: "medium",
    tier: "user",
  };
}

function sampleRequest(): ToolCallRequest {
  return {
    agentType: "openclaw",
    instanceId: "openclaw/session-x",
    tool: "gmail_send",
    args: { to: "bob@example.com" },
    estimatedCost: 0,
  };
}

describe("ApprovalQueue", () => {
  let queue: ApprovalQueue;

  beforeEach(() => {
    queue = new ApprovalQueue();
  });

  afterEach(() => {
    queue.shutdown();
  });

  it("assigns unique ids to new pending approvals", async () => {
    const p1 = queue.request(sampleDecision(), sampleRequest(), 60000);
    const p2 = queue.request(sampleDecision(), sampleRequest(), 60000);
    const pending = queue.list();
    expect(pending).toHaveLength(2);
    expect(pending[0].id).not.toBe(pending[1].id);
    queue.respond(pending[0].id, { choice: "deny" });
    queue.respond(pending[1].id, { choice: "deny" });
    await p1;
    await p2;
  });

  it("resolves when respond is called with allow_once", async () => {
    const promise = queue.request(sampleDecision(), sampleRequest(), 60000);
    const [p] = queue.list();
    queue.respond(p.id, { choice: "allow_once" });
    const response = await promise;
    expect(response.choice).toBe("allow_once");
  });

  it("resolves with deny after timeout", async () => {
    vi.useFakeTimers();
    const promise = queue.request(sampleDecision(), sampleRequest(), 100);
    vi.advanceTimersByTime(150);
    const response = await promise;
    expect(response.choice).toBe("deny");
    expect(queue.list()).toHaveLength(0);
    vi.useRealTimers();
  });

  it("removes approval from list after respond", async () => {
    const promise = queue.request(sampleDecision(), sampleRequest(), 60000);
    const [p] = queue.list();
    queue.respond(p.id, { choice: "allow_once" });
    await promise;
    expect(queue.list()).toHaveLength(0);
  });

  it("emits approval_request event when request is made", () => {
    const handler = vi.fn();
    queue.on("approval_request", handler);
    const promise = queue.request(sampleDecision(), sampleRequest(), 60000);
    expect(handler).toHaveBeenCalledOnce();
    const [p] = queue.list();
    queue.respond(p.id, { choice: "deny" });
    return promise;
  });

  it("emits approval_resolved event when respond is called", async () => {
    const handler = vi.fn();
    queue.on("approval_resolved", handler);
    const promise = queue.request(sampleDecision(), sampleRequest(), 60000);
    const [p] = queue.list();
    queue.respond(p.id, { choice: "allow_once" });
    await promise;
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].id).toBe(p.id);
  });

  it("respond on unknown id is a no-op", () => {
    expect(() => queue.respond("missing", { choice: "deny" })).not.toThrow();
  });

  it("configurable timeout_action=allow resolves with allow_once on timeout", async () => {
    vi.useFakeTimers();
    const q = new ApprovalQueue({ timeoutAction: "allow" });
    const promise = q.request(sampleDecision(), sampleRequest(), 100);
    vi.advanceTimersByTime(150);
    const response = await promise;
    expect(response.choice).toBe("allow_once");
    vi.useRealTimers();
    q.shutdown();
  });
});
```

- [ ] **Step 2:** Run tests — should fail (cannot resolve queue.js)
  ```bash
  cd packages/core && pnpm test tests/approval/queue.test.ts
  ```

- [ ] **Step 3:** Implement `packages/core/src/approval/queue.ts`:

```ts
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { PolicyDecision } from "../policy/decisions.js";
import type { ToolCallRequest } from "../proxy/server.js";
import type { PendingApproval, ApprovalResponse } from "./types.js";

interface QueuedApproval {
  pending: PendingApproval;
  resolve: (response: ApprovalResponse) => void;
  timeoutHandle: NodeJS.Timeout;
}

export interface ApprovalQueueOptions {
  /** What to do when an approval times out. Default: "deny". */
  timeoutAction?: "allow" | "deny";
}

/**
 * Holds pending approval requests in memory.
 * Emits events so IPC layers can forward requests to humans.
 *
 * Events:
 *  - "approval_request" (pending: PendingApproval)
 *  - "approval_resolved" (pending: PendingApproval, response: ApprovalResponse)
 *  - "approval_timeout" (pending: PendingApproval)
 */
export class ApprovalQueue extends EventEmitter {
  private queue: Map<string, QueuedApproval> = new Map();
  private timeoutAction: "allow" | "deny";

  constructor(options: ApprovalQueueOptions = {}) {
    super();
    this.timeoutAction = options.timeoutAction ?? "deny";
  }

  request(
    decision: PolicyDecision,
    request: ToolCallRequest,
    timeoutMs: number
  ): Promise<ApprovalResponse> {
    const id = randomUUID();
    const now = new Date();
    const pending: PendingApproval = {
      id,
      decision,
      request,
      createdAt: now,
      expiresAt: new Date(now.getTime() + timeoutMs),
    };

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        const entry = this.queue.get(id);
        if (!entry) return;
        this.queue.delete(id);
        const response: ApprovalResponse = {
          choice: this.timeoutAction === "allow" ? "allow_once" : "deny",
          note: "auto-resolved on timeout",
        };
        this.emit("approval_timeout", pending);
        this.emit("approval_resolved", pending, response);
        entry.resolve(response);
      }, timeoutMs);

      this.queue.set(id, {
        pending,
        resolve,
        timeoutHandle,
      });

      this.emit("approval_request", pending);
    });
  }

  respond(id: string, response: ApprovalResponse): void {
    const entry = this.queue.get(id);
    if (!entry) return;
    clearTimeout(entry.timeoutHandle);
    this.queue.delete(id);
    this.emit("approval_resolved", entry.pending, response);
    entry.resolve(response);
  }

  list(): PendingApproval[] {
    return Array.from(this.queue.values()).map((q) => q.pending);
  }

  cancel(id: string): void {
    const entry = this.queue.get(id);
    if (!entry) return;
    clearTimeout(entry.timeoutHandle);
    this.queue.delete(id);
  }

  shutdown(): void {
    for (const entry of this.queue.values()) {
      clearTimeout(entry.timeoutHandle);
    }
    this.queue.clear();
    this.removeAllListeners();
  }
}
```

- [ ] **Step 4:** Run tests — should pass (8 tests)
  ```bash
  cd packages/core && pnpm test tests/approval/queue.test.ts
  ```

- [ ] **Step 5:** Run full suite — should still pass
  ```bash
  cd packages/core && pnpm test
  ```

- [ ] **Step 6:** Commit
  ```bash
  git add packages/core/src/approval/queue.ts packages/core/tests/approval/queue.test.ts
  git commit -m "feat(approval): add ApprovalQueue with timeout and event emitter"
  ```

---

### Task 4: Extend ApprovalConfig

**File:** modify `packages/core/src/policy/types.ts`

- [ ] **Step 1:** In `packages/core/src/policy/types.ts`, replace the existing `ApprovalConfig` interface with:

```ts
export interface ApprovalConfig {
  timeout?: string;              // duration string like "5m"
  timeout_action?: "deny" | "allow";
  batch_similar?: boolean;
  /**
   * Tools and tool tags that always require approval, overriding user allow rules.
   * Checked before user rules in the policy engine.
   */
  require_for?: {
    tools?: string[];
    tool_tags?: string[];
  };
}
```

- [ ] **Step 2:** Run full test suite — should still pass
  ```bash
  cd packages/core && pnpm test
  ```

- [ ] **Step 3:** Commit
  ```bash
  git add packages/core/src/policy/types.ts
  git commit -m "feat(policy): extend ApprovalConfig with require_for override"
  ```

---

### Task 5: Wire ApprovalQueue into ProxyDispatcher

**Files:**
- Modify: `packages/core/src/proxy/server.ts`
- Modify: `packages/core/tests/proxy/server.test.ts` (add 2 new tests)

- [ ] **Step 1:** Modify `packages/core/src/proxy/server.ts`. Add import and update the class:

Add to imports:
```ts
import type { ApprovalQueue } from "../approval/queue.js";
import type { Rule } from "../policy/types.js";
```

Update `DispatcherDeps` (add optional approval):
```ts
export interface DispatcherDeps {
  policy: PolicyEngine;
  tracker: CostTracker;
  budget: BudgetEnforcer;
  audit: AuditLogger;
  instances: InstanceTracker;
  forwarder: Forwarder;
  approval?: ApprovalQueue;           // NEW
  approvalTimeoutMs?: number;         // NEW, default 5 minutes
}
```

Update `handleToolCall`. After the current policy + budget decision is computed, BEFORE the audit log block, insert:

```ts
    // 2b. If decision is require_approval AND approval queue is available, ask the human.
    if (decision.action === "require_approval" && this.deps.approval) {
      const timeoutMs = this.deps.approvalTimeoutMs ?? 5 * 60 * 1000;
      const response = await this.deps.approval.request(decision, req, timeoutMs);

      if (response.choice === "allow_once") {
        decision = { ...decision, action: "allow", reason: `approved: ${decision.reason}` };
      } else if (response.choice === "allow_session") {
        // Add a session override so subsequent matching calls auto-allow.
        const durationMs = response.durationMs ?? 60 * 60 * 1000;
        const rule: Rule = {
          match: { tool: req.tool },
          action: "allow",
          reason: `session approval: ${decision.reason}`,
        };
        this.deps.policy.addSessionOverride(rule, new Date(Date.now() + durationMs));
        decision = { ...decision, action: "allow", tier: "session", reason: `session approved: ${decision.reason}` };
      } else {
        decision = { ...decision, action: "deny", reason: `denied: ${decision.reason}` };
      }
    } else if (decision.action === "require_approval") {
      // No approval queue available — degrade to deny.
      decision = { ...decision, action: "deny", reason: `no approval handler: ${decision.reason}` };
    }
```

Change the `let decision: PolicyDecision` to not be `const` in the existing code if needed — make sure `decision` can be reassigned.

- [ ] **Step 2:** Add 2 new tests to `packages/core/tests/proxy/server.test.ts`:

At the top, add imports:
```ts
import { ApprovalQueue } from "../../src/approval/queue.js";
```

Add a new `describe` block AFTER the existing `describe("ProxyDispatcher", ...)` block:

```ts
describe("ProxyDispatcher with ApprovalQueue", () => {
  let dir: string;
  let dispatcher: ProxyDispatcher;
  let audit: AuditLogger;
  let queue: ApprovalQueue;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-"));
    const policy = new PolicyEngine([
      { match: { tool: "gmail_send" }, action: "require_approval", reason: "needs approval" },
    ]);
    const tracker = new CostTracker();
    const budget = new BudgetEnforcer(tracker, {});
    audit = new AuditLogger(join(dir, "audit.db"));
    const instances = new InstanceTracker();
    const forwarder = new Forwarder();
    queue = new ApprovalQueue();

    dispatcher = new ProxyDispatcher({
      policy,
      tracker,
      budget,
      audit,
      instances,
      forwarder,
      approval: queue,
      approvalTimeoutMs: 1000,
    });
  });

  afterEach(() => {
    audit.close();
    queue.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("waits for human approval and proceeds on allow_once", async () => {
    const pendingPromise = dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "gmail_send",
      args: { to: "x" },
      estimatedCost: 0,
    });
    // Simulate human response
    await new Promise((r) => setTimeout(r, 10));
    const pending = queue.list();
    expect(pending).toHaveLength(1);
    queue.respond(pending[0].id, { choice: "allow_once" });
    const result = await pendingPromise;
    expect(result.decision.action).toBe("allow");
    expect(result.forwarded).toBe(true);
  });

  it("denies on human deny response", async () => {
    const pendingPromise = dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "gmail_send",
      args: { to: "x" },
      estimatedCost: 0,
    });
    await new Promise((r) => setTimeout(r, 10));
    const pending = queue.list();
    queue.respond(pending[0].id, { choice: "deny" });
    const result = await pendingPromise;
    expect(result.decision.action).toBe("deny");
    expect(result.forwarded).toBe(false);
  });

  it("auto-denies on timeout when no human responds", async () => {
    const pendingPromise = dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "gmail_send",
      args: { to: "x" },
      estimatedCost: 0,
    });
    const result = await pendingPromise;
    expect(result.decision.action).toBe("deny");
    expect(result.decision.reason).toContain("denied");
  });
});
```

- [ ] **Step 3:** Run tests — expect 3 new pass, no regressions
  ```bash
  cd packages/core && pnpm test tests/proxy/server.test.ts
  ```

- [ ] **Step 4:** Run full suite
  ```bash
  cd packages/core && pnpm test
  ```

- [ ] **Step 5:** Commit
  ```bash
  git add packages/core/src/proxy/server.ts packages/core/tests/proxy/server.test.ts
  git commit -m "feat(proxy): wire ApprovalQueue into ProxyDispatcher"
  ```

---

### Task 6: IPC protocol definitions

**File:** Create `packages/core/src/ipc/protocol.ts`

- [ ] **Step 1:** Write `packages/core/src/ipc/protocol.ts`:

```ts
import type { PendingApproval, ApprovalResponse } from "../approval/types.js";
import type { AuditEntry } from "../audit/types.js";

/** Messages sent from server (proxy) to client (watcher / Tauri UI). */
export type ServerMessage =
  | { type: "hello"; version: string }
  | { type: "approval_request"; id: string; pending: SerializedPendingApproval }
  | { type: "approval_resolved"; id: string; outcome: ApprovalResponse["choice"] }
  | { type: "pending_list"; pending: SerializedPendingApproval[] }
  | { type: "audit"; entry: AuditEntry }
  | { type: "error"; message: string };

/** Messages sent from client to server. */
export type ClientMessage =
  | { type: "respond"; id: string; choice: ApprovalResponse["choice"]; durationMs?: number; note?: string }
  | { type: "list_pending" };

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

export function serializePending(p: PendingApproval): SerializedPendingApproval {
  return {
    id: p.id,
    agentType: p.request.agentType,
    instanceId: p.request.instanceId,
    tool: p.request.tool,
    args: p.request.args,
    reason: p.decision.reason,
    estimatedCost: p.request.estimatedCost,
    createdAt: p.createdAt.toISOString(),
    expiresAt: p.expiresAt.toISOString(),
  };
}

export function encode(msg: ServerMessage | ClientMessage): string {
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
      // skip malformed lines
    }
  }
  return { messages, remainder };
}
```

- [ ] **Step 2:** Commit
  ```bash
  git add packages/core/src/ipc/protocol.ts
  git commit -m "feat(ipc): add NDJSON protocol for approval IPC"
  ```

---

### Task 7: Unix socket server

**Files:**
- Create: `packages/core/src/ipc/server.ts`
- Create: `packages/core/tests/ipc/server.test.ts`

- [ ] **Step 1:** Write failing tests at `packages/core/tests/ipc/server.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createConnection } from "node:net";
import { ApprovalQueue } from "../../src/approval/queue.js";
import { IpcServer } from "../../src/ipc/server.js";
import { encode, decodeLines, type ServerMessage } from "../../src/ipc/protocol.js";
import type { PolicyDecision } from "../../src/policy/decisions.js";
import type { ToolCallRequest } from "../../src/proxy/server.js";

function sampleDecision(): PolicyDecision {
  return {
    action: "require_approval",
    reason: "needs approval",
    tool: "gmail_send",
    enforcement: "soft_mandatory",
    risk_level: "medium",
    tier: "user",
  };
}

function sampleRequest(): ToolCallRequest {
  return {
    agentType: "openclaw",
    instanceId: "openclaw/test",
    tool: "gmail_send",
    args: { to: "x" },
    estimatedCost: 0,
  };
}

async function collectMessages(socket: any, n: number, timeoutMs = 1000): Promise<ServerMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: ServerMessage[] = [];
    let buffer = "";
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${n} messages, got ${messages.length}`)), timeoutMs);
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const { messages: parsed, remainder } = decodeLines(buffer);
      buffer = remainder;
      for (const msg of parsed) {
        messages.push(msg as ServerMessage);
        if (messages.length >= n) {
          clearTimeout(timer);
          resolve(messages);
          return;
        }
      }
    });
  });
}

describe("IpcServer", () => {
  let dir: string;
  let socketPath: string;
  let queue: ApprovalQueue;
  let server: IpcServer;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-ipc-"));
    socketPath = join(dir, "agentguard.sock");
    queue = new ApprovalQueue();
    server = new IpcServer(queue, socketPath);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    queue.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a client and sends hello", async () => {
    const socket = createConnection(socketPath);
    const [hello] = await collectMessages(socket, 1);
    expect(hello.type).toBe("hello");
    socket.end();
  });

  it("broadcasts approval_request when queue emits", async () => {
    const socket = createConnection(socketPath);
    await collectMessages(socket, 1); // consume hello
    queue.request(sampleDecision(), sampleRequest(), 60000);
    const [msg] = await collectMessages(socket, 1);
    expect(msg.type).toBe("approval_request");
    if (msg.type === "approval_request") {
      expect(msg.pending.tool).toBe("gmail_send");
    }
    socket.end();
  });

  it("forwards client respond message to queue", async () => {
    const socket = createConnection(socketPath);
    await collectMessages(socket, 1);
    const promise = queue.request(sampleDecision(), sampleRequest(), 60000);
    const [req] = await collectMessages(socket, 1);
    if (req.type !== "approval_request") throw new Error("expected approval_request");
    socket.write(encode({ type: "respond", id: req.id, choice: "allow_once" }));
    const response = await promise;
    expect(response.choice).toBe("allow_once");
    socket.end();
  });

  it("sends pending_list on list_pending", async () => {
    queue.request(sampleDecision(), sampleRequest(), 60000);
    const socket = createConnection(socketPath);
    await collectMessages(socket, 1); // hello
    // Server emits any already-pending approvals automatically on connect, via approval_request
    // But a fresh client can explicitly ask:
    socket.write(encode({ type: "list_pending" }));
    const next = await collectMessages(socket, 2); // approval_request (auto on connect) + pending_list OR just pending_list
    // Accept either order
    const listMsg = next.find((m) => m.type === "pending_list");
    expect(listMsg).toBeDefined();
    if (listMsg?.type === "pending_list") {
      expect(listMsg.pending).toHaveLength(1);
    }
    socket.end();
  });

  it("cleans up stale socket file on start", async () => {
    // server is already running; stop it and restart to test stale file handling
    await server.stop();
    // leave the socket file in place
    const newQueue = new ApprovalQueue();
    const newServer = new IpcServer(newQueue, socketPath);
    await newServer.start();
    const socket = createConnection(socketPath);
    const [hello] = await collectMessages(socket, 1);
    expect(hello.type).toBe("hello");
    socket.end();
    await newServer.stop();
    newQueue.shutdown();
  });
});
```

- [ ] **Step 2:** Run tests — should fail (server.js missing)
  ```bash
  cd packages/core && pnpm test tests/ipc/server.test.ts
  ```

- [ ] **Step 3:** Implement `packages/core/src/ipc/server.ts`:

```ts
import { createServer, type Server, type Socket } from "node:net";
import { existsSync, unlinkSync, chmodSync } from "node:fs";
import type { ApprovalQueue } from "../approval/queue.js";
import type { PendingApproval } from "../approval/types.js";
import {
  encode,
  decodeLines,
  serializePending,
  type ClientMessage,
  type ServerMessage,
} from "./protocol.js";

export class IpcServer {
  private server: Server | null = null;
  private clients: Set<Socket> = new Set();
  private onApprovalRequest = (pending: PendingApproval): void => {
    this.broadcast({
      type: "approval_request",
      id: pending.id,
      pending: serializePending(pending),
    });
  };
  private onApprovalResolved = (pending: PendingApproval, response: { choice: string }): void => {
    this.broadcast({
      type: "approval_resolved",
      id: pending.id,
      outcome: response.choice as "allow_once" | "allow_session" | "deny",
    });
  };

  constructor(private queue: ApprovalQueue, private socketPath: string) {}

  async start(): Promise<void> {
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch (err) {
        throw new Error(`Failed to remove stale socket ${this.socketPath}: ${(err as Error).message}`);
      }
    }

    this.server = createServer((socket) => this.handleConnection(socket));

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.socketPath, () => {
        this.server!.off("error", reject);
        try {
          chmodSync(this.socketPath, 0o600);
        } catch {
          // best-effort
        }
        resolve();
      });
    });

    this.queue.on("approval_request", this.onApprovalRequest);
    this.queue.on("approval_resolved", this.onApprovalResolved);
  }

  async stop(): Promise<void> {
    this.queue.off("approval_request", this.onApprovalRequest);
    this.queue.off("approval_resolved", this.onApprovalResolved);

    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();

    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }

    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        // best-effort
      }
    }
  }

  private handleConnection(socket: Socket): void {
    this.clients.add(socket);

    // Send hello immediately
    socket.write(encode({ type: "hello", version: "0.1.0" }));

    // Send any currently pending approvals so a reconnecting client catches up
    for (const pending of this.queue.list()) {
      socket.write(encode({
        type: "approval_request",
        id: pending.id,
        pending: serializePending(pending),
      }));
    }

    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const { messages, remainder } = decodeLines(buffer);
      buffer = remainder;
      for (const msg of messages) {
        this.handleClientMessage(socket, msg as ClientMessage);
      }
    });

    socket.on("close", () => {
      this.clients.delete(socket);
    });

    socket.on("error", () => {
      this.clients.delete(socket);
    });
  }

  private handleClientMessage(socket: Socket, msg: ClientMessage): void {
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;

    if (msg.type === "respond") {
      this.queue.respond(msg.id, {
        choice: msg.choice,
        durationMs: msg.durationMs,
        note: msg.note,
      });
    } else if (msg.type === "list_pending") {
      socket.write(encode({
        type: "pending_list",
        pending: this.queue.list().map(serializePending),
      }));
    }
  }

  private broadcast(msg: ServerMessage): void {
    const line = encode(msg);
    for (const client of this.clients) {
      try {
        client.write(line);
      } catch {
        // client may be disconnecting; drop
      }
    }
  }
}
```

- [ ] **Step 4:** Run tests — should pass (5 tests)
  ```bash
  cd packages/core && pnpm test tests/ipc/server.test.ts
  ```

- [ ] **Step 5:** Run full suite
  ```bash
  cd packages/core && pnpm test
  ```

- [ ] **Step 6:** Commit
  ```bash
  git add packages/core/src/ipc/server.ts packages/core/tests/ipc/server.test.ts
  git commit -m "feat(ipc): add Unix socket server broadcasting approval events"
  ```

---

### Task 8: `agentguard watch` CLI command

**File:** create `packages/core/src/cli/commands/watch.ts`

- [ ] **Step 1:** Write `packages/core/src/cli/commands/watch.ts`:

```ts
import { createConnection, type Socket } from "node:net";
import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { getConfigDir } from "../../config/paths.js";
import { encode, decodeLines, type ServerMessage, type SerializedPendingApproval } from "../../ipc/protocol.js";

const SOCKET_FILE = "agentguard.sock";

export async function watchCommand(): Promise<void> {
  const socketPath = join(getConfigDir(), SOCKET_FILE);
  if (!existsSync(socketPath)) {
    console.error(chalk.red(`Socket not found: ${socketPath}`));
    console.error(chalk.gray("Is AgentGuard running? Try: agentguard start"));
    process.exit(1);
  }

  const socket = createConnection(socketPath);
  const pendingQueue: SerializedPendingApproval[] = [];
  let processing = false;

  socket.on("connect", () => {
    console.log(chalk.green(`Connected to AgentGuard (${socketPath})`));
    console.log(chalk.gray("Watching for approval requests…\n"));
  });

  socket.on("error", (err) => {
    console.error(chalk.red(`Socket error: ${err.message}`));
    process.exit(1);
  });

  socket.on("close", () => {
    console.log(chalk.yellow("\nDisconnected from AgentGuard."));
    process.exit(0);
  });

  let buffer = "";
  socket.on("data", async (chunk) => {
    buffer += chunk.toString();
    const { messages, remainder } = decodeLines(buffer);
    buffer = remainder;
    for (const raw of messages) {
      const msg = raw as ServerMessage;
      if (msg.type === "hello") {
        console.log(chalk.gray(`Server version: ${msg.version}`));
      } else if (msg.type === "approval_request") {
        pendingQueue.push(msg.pending);
        void processNext(socket, pendingQueue, () => { processing = false; }, () => processing);
        if (!processing) processing = true;
      } else if (msg.type === "approval_resolved") {
        // Could show a confirmation; for now just ignore
      }
    }
  });

  process.on("SIGINT", () => {
    console.log(chalk.yellow("\nShutting down watcher…"));
    socket.end();
    process.exit(0);
  });
}

async function processNext(
  socket: Socket,
  queue: SerializedPendingApproval[],
  done: () => void,
  isProcessing: () => boolean
): Promise<void> {
  if (queue.length === 0) {
    done();
    return;
  }

  const next = queue.shift()!;
  renderRequest(next);

  const { choice } = await inquirer.prompt<{ choice: string }>([
    {
      type: "list",
      name: "choice",
      message: "What would you like to do?",
      choices: [
        { name: "Allow once", value: "allow_once" },
        { name: "Allow similar for 1 hour", value: "allow_session_1h" },
        { name: "Allow similar for this session (8h)", value: "allow_session_8h" },
        { name: "Deny", value: "deny" },
      ],
    },
  ]);

  let response;
  switch (choice) {
    case "allow_once":
      response = { type: "respond" as const, id: next.id, choice: "allow_once" as const };
      break;
    case "allow_session_1h":
      response = {
        type: "respond" as const,
        id: next.id,
        choice: "allow_session" as const,
        durationMs: 60 * 60 * 1000,
      };
      break;
    case "allow_session_8h":
      response = {
        type: "respond" as const,
        id: next.id,
        choice: "allow_session" as const,
        durationMs: 8 * 60 * 60 * 1000,
      };
      break;
    case "deny":
    default:
      response = { type: "respond" as const, id: next.id, choice: "deny" as const };
      break;
  }

  socket.write(encode(response));
  console.log(chalk.gray(`→ sent: ${choice}\n`));

  // Process any additional queued items
  void processNext(socket, queue, done, isProcessing);
}

function renderRequest(p: SerializedPendingApproval): void {
  const expiresAt = new Date(p.expiresAt);
  const secondsLeft = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  console.log(chalk.bold.yellow("🔔 APPROVAL NEEDED"));
  console.log(`  Agent:    ${chalk.cyan(p.agentType)} (${chalk.gray(p.instanceId)})`);
  console.log(`  Tool:     ${chalk.magenta(p.tool)}`);
  console.log(`  Args:     ${chalk.gray(JSON.stringify(p.args))}`);
  console.log(`  Reason:   ${chalk.yellow(p.reason)}`);
  console.log(`  Cost:     ${chalk.gray(`$${p.estimatedCost.toFixed(4)}`)}`);
  console.log(`  Expires:  ${chalk.gray(`${minutes}m ${seconds}s`)}`);
  console.log();
}
```

- [ ] **Step 2:** Commit
  ```bash
  git add packages/core/src/cli/commands/watch.ts
  git commit -m "feat(cli): add agentguard watch command with inquirer prompts"
  ```

---

### Task 9: Wire approval + IPC into `agentguard start`

**Files:**
- Modify: `packages/core/src/cli/commands/start.ts`
- Modify: `packages/core/src/cli/index.ts`

- [ ] **Step 1:** Modify `packages/core/src/cli/commands/start.ts`. Add imports:

```ts
import { join } from "node:path";
import { ApprovalQueue } from "../../approval/queue.js";
import { IpcServer } from "../../ipc/server.js";
```

Inside `startCommand` function, after creating `forwarder` and before creating `dispatcher`, add:

```ts
  // Approval queue + IPC server
  const approval = new ApprovalQueue({
    timeoutAction: config.approval?.timeout_action ?? "deny",
  });
  const socketPath = join(getConfigDir(), "agentguard.sock");
  const ipcServer = new IpcServer(approval, socketPath);
  try {
    await ipcServer.start();
    console.error(chalk.gray(`IPC:    ${socketPath}`));
  } catch (err) {
    console.error(chalk.yellow(`! Failed to start IPC server: ${(err as Error).message}`));
    console.error(chalk.yellow("  Approval requests will auto-deny."));
  }
```

Add `getConfigDir` to imports from `../../config/paths.js` (it was already imported there).

Pass `approval` to the dispatcher:
```ts
  const dispatcher = new ProxyDispatcher({
    policy,
    tracker,
    budget,
    audit,
    instances,
    forwarder,
    approval,
    approvalTimeoutMs: parseDurationToMs(config.approval?.timeout ?? "5m"),
  });
```

Add helper function at bottom of file:
```ts
function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h)$/);
  if (!match) return 5 * 60 * 1000;
  const v = parseInt(match[1], 10);
  const unit = match[2];
  return unit === "s" ? v * 1000 : unit === "m" ? v * 60 * 1000 : v * 60 * 60 * 1000;
}
```

Update shutdown handler:
```ts
  const shutdown = async () => {
    console.error(chalk.yellow("\nShutting down AgentGuard..."));
    await ipcServer.stop().catch(() => {});
    approval.shutdown();
    audit.close();
    process.exit(0);
  };
```

- [ ] **Step 2:** Modify `packages/core/src/cli/index.ts`. Add:

```ts
import { watchCommand } from "./commands/watch.js";
```

Register after `logs` command:

```ts
program
  .command("watch")
  .description("Interactive approval terminal")
  .action(watchCommand);
```

- [ ] **Step 3:** Build
  ```bash
  cd packages/core && pnpm build
  ```
  Expected: clean build.

- [ ] **Step 4:** Run full suite
  ```bash
  cd packages/core && pnpm test
  ```
  Expected: all tests still pass.

- [ ] **Step 5:** Commit
  ```bash
  git add packages/core/src/cli/commands/start.ts packages/core/src/cli/index.ts
  git commit -m "feat(cli): wire approval queue + IPC server into start and register watch"
  ```

---

### Task 10: End-to-end approval flow test

**File:** create `packages/core/tests/e2e/approval-flow.test.ts`

This spawns the real `agentguard start` subprocess, connects to the socket as a client, sends an MCP tool call that triggers require_approval, responds via the socket, and verifies the agent sees the allowed response.

- [ ] **Step 1:** Write `packages/core/tests/e2e/approval-flow.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { encode, decodeLines, type ServerMessage } from "../../src/ipc/protocol.js";

const CLI = "dist/cli/index.js";

async function waitForFile(path: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { existsSync } = await import("node:fs");
      if (existsSync(path)) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timeout waiting for ${path}`);
}

describe("E2E approval flow", () => {
  let homeDir: string;
  let env: NodeJS.ProcessEnv;
  let socketPath: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "agentguard-home-"));
    env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
    socketPath = join(homeDir, ".agentguard", "agentguard.sock");

    // Create .agentguard dir with a config that requires approval for gmail_send
    const configDir = join(homeDir, ".agentguard");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.yaml"),
      `
budget:
  per_request: 100
approval:
  timeout: "3s"
  timeout_action: deny
rules:
  - match:
      tool: gmail_send
    action: require_approval
    reason: "Outbound email"
  - match:
      tool: "*"
    action: allow
`
    );
    writeFileSync(join(configDir, "agents.yaml"), "agents: {}\n");
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("agent tool call triggering approval → human allows → agent sees allow", async () => {
    const mcpTransport = new StdioClientTransport({
      command: "node",
      args: [CLI, "start"],
      env: env as Record<string, string>,
    });
    const mcp = new Client({ name: "e2e-test", version: "0.1.0" }, { capabilities: {} });
    await mcp.connect(mcpTransport);

    // Wait for the IPC socket to appear
    await waitForFile(socketPath);

    // Connect a fake watcher
    const watcher: Socket = createConnection(socketPath);
    await new Promise<void>((resolve, reject) => {
      watcher.once("connect", resolve);
      watcher.once("error", reject);
    });

    let buffer = "";
    const messages: ServerMessage[] = [];
    watcher.on("data", (chunk) => {
      buffer += chunk.toString();
      const { messages: parsed, remainder } = decodeLines(buffer);
      buffer = remainder;
      for (const m of parsed) messages.push(m as ServerMessage);
    });

    // Wait for hello
    await new Promise<void>((resolve) => {
      const check = () => {
        if (messages.some((m) => m.type === "hello")) return resolve();
        setTimeout(check, 20);
      };
      check();
    });

    // Kick off the tool call from the agent side
    const callPromise = mcp.callTool({
      name: "agentguard_proxy",
      arguments: {
        agent_type: "openclaw",
        tool_name: "gmail_send",
        tool_args: { to: "bob@example.com" },
        estimated_cost: 0,
      },
    });

    // Wait for approval_request
    await new Promise<void>((resolve) => {
      const check = () => {
        if (messages.some((m) => m.type === "approval_request")) return resolve();
        setTimeout(check, 20);
      };
      check();
    });

    const req = messages.find((m) => m.type === "approval_request")!;
    if (req.type !== "approval_request") throw new Error("unreachable");

    // Respond allow_once
    watcher.write(encode({ type: "respond", id: req.id, choice: "allow_once" }));

    const result: any = await callPromise;
    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("allow");
    expect(result.isError).toBe(false);

    watcher.end();
    await mcp.close();
  }, 15000);

  it("agent tool call with no watcher → timeout → auto-deny", async () => {
    const mcpTransport = new StdioClientTransport({
      command: "node",
      args: [CLI, "start"],
      env: env as Record<string, string>,
    });
    const mcp = new Client({ name: "e2e-test-2", version: "0.1.0" }, { capabilities: {} });
    await mcp.connect(mcpTransport);
    await waitForFile(socketPath);

    // No watcher connects

    const result: any = await mcp.callTool({
      name: "agentguard_proxy",
      arguments: {
        agent_type: "openclaw",
        tool_name: "gmail_send",
        tool_args: { to: "x" },
        estimated_cost: 0,
      },
    });

    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("deny");
    expect(result.isError).toBe(true);

    await mcp.close();
  }, 10000);
});
```

- [ ] **Step 2:** Build first (e2e test spawns the compiled CLI)
  ```bash
  cd packages/core && pnpm build
  ```

- [ ] **Step 3:** Run the e2e test
  ```bash
  cd packages/core && pnpm test tests/e2e/approval-flow.test.ts
  ```
  Expected: 2 tests pass.

- [ ] **Step 4:** Run full suite
  ```bash
  cd packages/core && pnpm test
  ```

- [ ] **Step 5:** Commit
  ```bash
  git add packages/core/tests/e2e/approval-flow.test.ts
  git commit -m "test(e2e): add approval flow test with real proxy subprocess"
  ```

---

### Task 11: Manual smoke + merge

- [ ] **Step 1:** Clean up any existing state
  ```bash
  rm -rf ~/.agentguard/audit.db ~/.agentguard/agentguard.sock 2>/dev/null
  cd /Users/vinh.hoang/github/agentguard
  node packages/core/dist/cli/index.js init --force
  node packages/core/dist/cli/index.js agent add --name openclaw --budget-daily 30
  ```

- [ ] **Step 2:** In one terminal, start the proxy:
  ```bash
  node packages/core/dist/cli/index.js start
  ```

- [ ] **Step 3:** In another terminal, start the watcher:
  ```bash
  node packages/core/dist/cli/index.js watch
  ```

- [ ] **Step 4:** Verify manually: send a tool call that triggers approval (via a small test client), respond in the watcher, confirm the agent gets the allow response.

- [ ] **Step 5:** Kill both processes.

- [ ] **Step 6:** Push the branch
  ```bash
  git push -u origin phase3a-approvals
  ```

- [ ] **Step 7:** Merge to main
  ```bash
  git checkout main
  git merge --no-ff phase3a-approvals -m "Merge phase3a-approvals: approval queue + IPC + CLI watcher

  Phase 3a adds human-in-the-loop approval support:
  - ApprovalQueue with EventEmitter and auto-deny timeout
  - Unix socket IPC server (NDJSON protocol)
  - agentguard watch CLI command
  - ProxyDispatcher waits on queue for require_approval decisions
  - E2E test exercises full approval flow with real subprocess"
  git push origin main
  ```

---

## Completion Criteria

Phase 3a is complete when:

1. All 11 tasks committed on `phase3a-approvals` branch
2. Full test suite passes (87 prior + ~18 new = ~105 tests)
3. `agentguard start` binds `~/.agentguard/agentguard.sock` with 0600 perms
4. `agentguard watch` connects and shows approval requests interactively
5. E2E test demonstrates: agent → require_approval → watcher responds → agent sees allow
6. E2E test demonstrates: agent → require_approval → no watcher → timeout → auto-deny
7. Phase 3a merged to main

After Phase 3a, the backend is ready for the Tauri GUI in Phase 3b. The same IPC protocol works for both the CLI watcher and the future Tauri app.
