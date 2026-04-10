# Phase 3a — Approval Backend Design Spec

**Date:** 2026-04-10
**Status:** Approved (in-session)
**Depends on:** Phase 1 Core MVP (already merged to main)

## Goal

Add human-in-the-loop approval support to the AgentGuard proxy so that `require_approval` policy decisions actually pause the tool call, notify a listener, and wait for a user response — with a working CLI fallback UX (`agentguard watch`) today, and a Unix socket IPC channel ready for the Tauri GUI in Phase 3b.

## Problem

Right now, the policy engine can emit `require_approval` decisions, but the `ProxyDispatcher` only has two terminal states: allow or deny. An approval decision is logged as an error (`isError: true`) and the tool call is never forwarded. There is no mechanism to ask the user and wait.

## Architecture

```
┌────────┐                    ┌─────────────────────┐
│ Agent  │──MCP tool call────▶│   ProxyDispatcher   │
└────────┘                    │                     │
                              │  PolicyEngine       │
                              │    ↓                │
                              │  decision ==        │
                              │  require_approval?  │
                              │    ↓ yes            │
                              │  ApprovalQueue      │
                              │    ↓ await          │
                              │  (blocks here)      │
                              └──────────┬──────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │ Unix socket              │                          │
              ▼                          ▼                          ▼
       ┌────────────┐           ┌────────────┐           ┌────────────┐
       │ agentguard │           │ Tauri UI   │           │ (any IPC   │
       │ watch      │           │ (Phase 3b) │           │  client)   │
       │ (CLI)      │           │            │           │            │
       └────────────┘           └────────────┘           └────────────┘
       User types               User clicks              Scriptable
       a/s/d                    Allow/Deny button        integration
```

## Design

### Approval Queue

In-memory map of pending approval requests, each with a unique id, the pending tool call context, an expiry timer, and a promise resolver.

```ts
interface PendingApproval {
  id: string;                  // uuid-v4
  decision: PolicyDecision;    // the original decision (require_approval)
  request: ToolCallRequest;    // the original call context
  createdAt: Date;
  expiresAt: Date;
  resolve: (response: ApprovalResponse) => void;
}

type ApprovalResponse =
  | { choice: "allow_once" }
  | { choice: "allow_session"; durationMs: number }
  | { choice: "deny" };
```

Core API:
- `request(decision, request, timeoutMs): Promise<ApprovalResponse>` — creates a pending entry, starts a timer, emits an `approval_request` event, returns a promise that resolves when the user responds or the timer fires (auto-deny on timeout).
- `respond(id, response): void` — UI calls this to resolve a pending approval.
- `list(): PendingApproval[]` — returns all pending approvals (for UI polling or listing).
- `cancel(id): void` — removes an approval without resolving (agent disconnected, etc.).

### ProxyDispatcher integration

When the policy engine returns `require_approval`, the dispatcher calls `approvalQueue.request(...)` and awaits. Three outcomes:

| Response choice | Action |
|---|---|
| `allow_once` | Proceed as allow, record spend, log |
| `allow_session` | Add a session override rule to the policy engine (`duration` from response), proceed as allow |
| `deny` or timeout | Log as deny, do not forward |

### Unix Socket IPC Server

The proxy's `start` command spawns a Unix socket server at `~/.agentguard/agentguard.sock` (permissions 0600). Clients connect to receive approval events and submit responses. Protocol is newline-delimited JSON (NDJSON) — one message per line.

**Message types (server → client):**
```json
{"type":"hello","version":"0.1.0"}
{"type":"approval_request","id":"abc123","agent":"openclaw","instance":"openclaw/session-xyz","tool":"shell_execute","args":{"command":"rm -rf /tmp"},"reason":"Destructive command","expiresAt":"2026-04-10T12:30:00Z","estimatedCost":0}
{"type":"approval_resolved","id":"abc123","outcome":"allow_once"}
{"type":"audit","entry":{...}}   // optional live audit stream (Phase 3b)
```

**Message types (client → server):**
```json
{"type":"respond","id":"abc123","choice":"allow_once"}
{"type":"respond","id":"abc123","choice":"allow_session","durationMs":3600000}
{"type":"respond","id":"abc123","choice":"deny"}
{"type":"list_pending"}
```

The server supports multiple connected clients. The first client to respond to a given approval wins (race is fine — all responses are idempotent after the first resolution). Disconnected clients don't affect pending approvals.

### CLI Fallback: `agentguard watch`

A new CLI command that connects to the Unix socket and presents an interactive approval prompt via `inquirer`:

```
$ agentguard watch

Connected to AgentGuard (~/.agentguard/agentguard.sock)
Watching for approval requests…

🔔 APPROVAL NEEDED
  Agent: openclaw (instance: openclaw/session-xyz)
  Tool: shell_execute
  Args: { command: "git push --force origin main" }
  Reason: Outbound git operation
  Cost: $0.00
  Expires in: 4m 57s

  ? What would you like to do? (Use arrow keys)
  ❯ Allow once
    Allow similar for 1 hour
    Allow similar for this session
    Deny
```

The watcher shows pending approvals one at a time, FIFO order. After responding, it goes back to waiting. Ctrl+C exits cleanly.

### Policy Config Updates

Approvals need config knobs. Extend `ApprovalConfig` in `policy/types.ts`:

```yaml
approval:
  timeout: "5m"               # default wait time before auto-deny
  timeout_action: deny        # "deny" | "allow"
  require_for:                # NEW: tools that always require approval regardless of rules
    tools: ["stripe_*", "gmail_send"]
    tool_tags: ["communication", "payment"]
```

The `require_for` block is an override that forces `require_approval` for listed tools before user rules are checked. This gives users a "safety net" without needing to write explicit rules.

### Socket Lifecycle

- **On `agentguard start`:** Proxy binds to `~/.agentguard/agentguard.sock`. If the socket file exists but no one is listening (stale socket from previous crash), it is removed and recreated. If someone IS listening, abort with a clear error.
- **On agent tool call requiring approval:** Server emits `approval_request` to all connected clients.
- **On client connect:** Server immediately sends `hello` + current pending approvals (clients can reconnect after crash).
- **On client disconnect:** Server removes the client from its connection set. Pending approvals are unaffected.
- **On `agentguard start` shutdown:** Server closes all connections, removes the socket file.

### Error Handling

- If no client is connected when an approval is needed, the request still enters the queue. If a client connects within the timeout, it sees the pending approval on `hello`. If no one responds by the timeout, the configured `timeout_action` decides (default: deny).
- If the socket server fails to bind, the proxy logs a warning and continues without IPC — the CLI fallback won't work, but the proxy itself keeps running. Auto-deny is used for all require_approval decisions in this degraded mode.

## Out of Scope for Phase 3a

- Tauri / Electron / any GUI app (Phase 3b)
- Push notifications (macOS Notification Center, Telegram, Slack) — Phase 4
- Multi-user / team approvals — Phase 4
- Persistent approval history — already covered by audit log
- Remember-forever rules — Phase 3b (needs a UI flow)

## Files to Create or Modify

### New
- `packages/core/src/approval/types.ts` — `PendingApproval`, `ApprovalResponse`, `ApprovalRequestMessage`, etc.
- `packages/core/src/approval/queue.ts` — `ApprovalQueue` class (overwrite existing stub)
- `packages/core/src/ipc/server.ts` — Unix socket server
- `packages/core/src/ipc/protocol.ts` — message type definitions + (de)serialization
- `packages/core/src/cli/commands/watch.ts` — `agentguard watch` command
- Tests for each module

### Modify
- `packages/core/src/proxy/server.ts` — wire `ApprovalQueue` into `ProxyDispatcher`
- `packages/core/src/policy/types.ts` — extend `ApprovalConfig`
- `packages/core/src/cli/commands/start.ts` — create `ApprovalQueue`, spawn IPC server, pass queue to dispatcher
- `packages/core/src/cli/index.ts` — register `watch` command
- `packages/core/tsconfig.json` — un-exclude `src/approval/` (was Phase 2 stub)

## Success Criteria

1. `agentguard start` binds a Unix socket at `~/.agentguard/agentguard.sock` with 0600 perms.
2. `agentguard watch` connects to the socket and prints a "ready" banner.
3. When an agent calls a tool that a policy rule flags `require_approval`, the proxy:
   - Puts the call in the approval queue
   - Emits an `approval_request` message over the socket
   - Waits (up to timeout) for a response
4. User types `a` in watcher → approval resolves `allow_once` → proxy forwards tool call, records cost, logs.
5. User types `d` → approval resolves `deny` → proxy blocks, logs.
6. User takes no action → after timeout → auto-deny, logs.
7. `allow_session` choice creates a session override rule on the policy engine so subsequent calls matching the same tool auto-allow for the duration.
8. End-to-end smoke test exercises the full flow with a mock agent client + watcher client.
