# AgentGuard Architecture

Engineer onboarding doc. Assumes you know what MCP is. Pair this with `docs/specs/2026-04-08-agentguard-design.md` (business framing) and the phase plans in `docs/plans/` (implementation history).

## What AgentGuard is, in one sentence

A stdio MCP server that impersonates the MCP servers an agent wanted to talk to, intercepts every `tools/call`, and enforces policy + budget + human approval before forwarding.

## The data path

```
┌──────────┐  stdio/MCP   ┌──────────────── AgentGuard proxy ───────────────┐   stdio/MCP   ┌────────────┐
│  Agent   │ ◄──────────►│  McpServer (proxy/server.ts:142)                │ ◄────────────►│ filesystem │
│ (Open-   │              │    └─ ProxyDispatcher.handleToolCall()          │               │  fetch     │
│  Claw)   │              │        1. BudgetEnforcer.check()                │               │  sqlite    │
│          │              │        2. PolicyEngine.evaluate()               │               │  …         │
└──────────┘              │        3. ApprovalQueue.request() (if required) │               └────────────┘
                          │        4. AuditLogger.log() (allow or deny)     │
                          │        5. CostTracker.record() + forward        │
                          │  DownstreamManager owns all child MCP clients   │
                          └───────────┬─────────────────────────────────────┘
                                      │ IPC (unix socket)
                                      ▼
                              ┌───────────────┐
                              │ agentguard    │  human approves/denies
                              │   watch       │  soft_mandatory calls
                              └───────────────┘
```

Everything in `packages/core/src/` maps to one of those boxes.

## Read-these-first files

If you only have 30 minutes, read these four in order:

1. **`policy/engine.ts`** (~80 lines) — the security model. The header comment is load-bearing; read it verbatim.
2. **`proxy/server.ts:46-128`** — `ProxyDispatcher.handleToolCall`. The whole system's contract in ~80 lines. Numbered steps in the comments map to the modules below.
3. **`proxy/server.ts:142-229`** — `createMcpServer`. The MCP-protocol adapter wrapping the dispatcher.
4. **`downstream/manager.ts`** — how child MCP servers are spawned, indexed, and kept isolated from each other's failures.

## Module reference

### `proxy/` — the hot path

Split deliberately into two classes:

- **`ProxyDispatcher`** (`server.ts:46`) is pure logic. Takes a `ToolCallRequest`, returns a `ToolCallResult`. No transports, no child processes — this is what unit tests hit. Request order is numbered in the comments: budget → policy → approval → audit → spend → forward.
- **`createMcpServer`** (`server.ts:142`) is the MCP protocol adapter. Implements `ListTools` + `CallTool`. Pulls the aggregated catalog from `DownstreamManager`. On `allow` it calls `downstream.forward()` and returns the child server's response; on non-allow it returns a structured error to the agent.

**Vestigial file: `proxy/forwarder.ts`.** This is the Phase-1 stub. `Forwarder.forward()` throws "not yet wired". Today the dispatcher only uses `forwarder.routeFor(tool)` as an audit-log fallback to guess which server owned a tool when `DownstreamManager` can't attribute it. Real forwarding happens in `createMcpServer` via `DownstreamManager`. The `// Phase 1` comment at `server.ts:122` is accurate only for the dispatcher's role — don't read it as "forwarding is mocked."

### `downstream/` — child MCP server fleet

`downstream/manager.ts` is the supervisor:

- `start()` spawns every configured server in parallel with **per-server failure isolation** — one broken downstream doesn't take down the proxy. See tests at `tests/downstream/manager.test.ts`.
- Maintains two indexes: `tools` (flat list for `tools/list`) and `ownerIndex` (tool name → owning server).
- Handles namespace collisions when two downstreams advertise the same tool name (tool gets auto-prefixed; config can force a prefix).

`DownstreamClient` is the per-child wrapper — spawns the process, MCP handshake, tracks `isAlive()`.

### `policy/` — the decision engine

`policy/engine.ts` is a **3-tier, first-match-wins evaluator**. The header comment documents the model; the short version:

1. **Hard boundaries** (built-in, always win — cannot be overridden).
2. **Session overrides** (from `allow_session` approvals, time-limited).
3. **User rules** (from `~/.agentguard/config.yaml`).
4. **Default rules** (built-in fallbacks).
5. **Implicit deny** (fail-safe).

**Within a tier, first match wins** (iptables / Cloudflare WAF / security-groups model) — **not** true "deny-overrides-allow." Operators must order rules intentionally: specific denies before broad allows. This nuance is security-relevant and a common source of misconfig; call it out in any config review.

Hard boundaries can never be overridden, not even by session approvals. Session approvals *can* bypass user denies — that's explicit, because they originate from a human in the loop.

Other files:
- `policy/matcher.ts` — rule predicates (tool-name globs, server, arg patterns).
- `policy/decisions.ts` — the structured `PolicyDecision` type. Action + enforcement level + risk level + tier + reason + rule_matched. Downstream code uses the whole structure for audit and approval UX — do not collapse it to a boolean.
- `policy/built-in-rules.ts` — the non-negotiable deny list.

### `approval/` — human-in-the-loop

`approval/queue.ts` turns a `require_approval` decision into a blocking `await` on an in-process queue. `ProxyDispatcher` (`server.ts:71-88`) awaits `approval.request()` with a 5 min default timeout. Three outcomes:

- `allow_once` → single-call allow; decision flips.
- `allow_session` → flips decision **and** pushes a time-limited session override rule so future matching calls don't re-prompt.
- decline / timeout / no watcher attached → deny.

### `ipc/` — proxy ↔ watcher transport

Proxy runs attached to the agent's stdio. Watcher runs on its own tty. They communicate over a unix socket (`ipc/server.ts`, NDJSON protocol at `ipc/protocol.ts`). This is why operating the proxy needs two processes — one attached to the agent, one for approvals.

### `cost/` — budget + spend

- `cost/pricing.ts` — per-model token prices.
- `cost/tracker.ts` — records spend per instance.
- `cost/budget.ts` — `BudgetEnforcer.check()` returns either `null` (under budget) or a pre-built `deny` decision.

**Budget runs before policy** (`server.ts:53`). An over-budget call is denied even if a user `allow *` rule matches. Budget is effectively a hard boundary.

### `audit/` — forensic log

SQLite. Every call produces one row: timestamp, agent type, instance id, tool, args, mcp server, decision, tier, rule matched, reason, cost, latency, result status (`server.ts:95-109`). Audit logs every decision including denials — tamper-evidence requires continuity, so denied calls must appear too.

**Ops note:** keep the audit DB on a different physical drive from the agent's scratch data. An agent that compromises its workspace must not be able to delete its own audit trail.

### `identity/` — who is calling

Two-level model, baked into the data model:

- **Agent type** (e.g. `openclaw`) — permissions and daily budget live here. Registered via `agentguard agent add`.
- **Instance** — per-connection runtime identity, created lazily when the MCP connection opens (`server.ts:173-176`). Session overrides and per-instance spend attach here.

`identity/fingerprint.ts` computes a process fingerprint for verification. The `AGENTGUARD_AGENT` env var (`server.ts:224`) is how the CLI wrapper tells the proxy which agent type owns this connection.

### `install/` — middleware installer

`install/openclaw.ts` rewrites `~/.openclaw/openclaw.json`: migrates stdio servers into `~/.agentguard/config.yaml`, replaces OpenClaw's `mcp.servers` with a single `agentguard` entry, writes a timestamped backup. HTTP MCP servers stay in OpenClaw's config — only stdio is migrated (`migrateServersToAgentGuard`, `install/openclaw.ts:118`). Uninstall restores the latest backup.

### `registry/`, `threat/`, `learning/` — strategic, lower traffic

- `registry/` — Official/Smithery/Glama MCP registry clients (discovery).
- `threat/` — periodic sync of blocklisted servers and pattern signatures. Antivirus-style.
- `learning/` — observe mode + least-privilege policy profiler. Powers `agentguard learn --agent X`.

### `cli/` — commander thin wrapper

`cli/commands/` has `init`, `start`, `agent`, `logs`, `watch`, `install`, `learn`. All domain logic lives in the modules above; commands are assembly only.

## Invariants to keep in your head

- **Budget check precedes policy.** An over-budget call is denied even under an `allow *` rule.
- **Hard boundaries cannot be overridden.** Not by user rules, not by session approvals.
- **Session approvals can bypass user denies.** This is explicit — they originate from a human in the loop.
- **Implicit deny is the floor.** An empty config still fails safe.
- **Audit logs every decision.** Allow and deny. Latency and rule matched included.
- **One failing downstream doesn't fail the proxy.** The rest stay up; calls to the dead server get a structured error.
- **`PolicyDecision` is structured, not boolean.** Consumers need tier, reason, enforcement, rule_matched for UX and audit — don't collapse.

## Drift from the spec

`docs/specs/2026-04-08-agentguard-design.md` ("Approved" status) was written before implementation and has diverged. Known drift:

- Spec describes the evaluation model as "ALLOW (specificity) → explicit DENY → hard boundaries cannot be overridden." Implementation is the simpler and safer **first-match-wins within tier**, with hard boundaries on top. The code comment at `policy/engine.ts:1-16` is authoritative.
- Spec lists tier order as "built-in → user → session overrides." Implementation order is hard boundaries → session overrides → user rules → defaults → implicit deny.
- Spec shows cloud dashboard, threat feed, and Glama integration as connected components. These exist as scaffolding (`cloud/`, `threat/`, `registry/`) but are not wired end-to-end.

When spec and code disagree, **trust the code**. File drift against the spec as a doc issue; don't "fix" the engine to match the spec without an explicit decision.

## Testing

- 139 tests across 23 files. `pnpm test` from repo root, or `pnpm test` in `packages/core`.
- Unit tests target the pure-logic modules (`policy`, `cost`, `approval`, `identity`).
- `tests/e2e/` covers the proxy + real downstream MCP servers (filesystem, mock approval flow).
- CLI smoke tests in `tests/e2e/cli-smoke.test.ts`.
- No mocked filesystem in tests — `tests/downstream/manager.test.ts` spawns real MCP servers. Slower but catches integration drift.

## Common extension points

- **New downstream server** — add to `mcp_servers:` in `~/.agentguard/config.yaml`. No code change.
- **New policy rule** — add to `rules:` under the config. Engine picks it up at startup.
- **Built-in hard boundary** — edit `policy/built-in-rules.ts`. Security-sensitive; expect review.
- **New CLI command** — file in `cli/commands/`, register in `cli/index.ts`.
- **New decision field** — touch `policy/decisions.ts` and `audit/types.ts` together; audit-log schema needs to match.

## Things to know that aren't obvious from the code

- **Two tmux panes are the normal dev setup.** Proxy pane is attached to the agent (stdio); `agentguard watch` runs in the other. There is no "one process does both."
- **The `learn` flow is the intended onboarding path** for a new agent, not manual rule writing. Observe mode → profile → tighten.
- **`agentguard install openclaw` writes a timestamped backup** on every run. Safe to re-run; `--force` overwrites an existing agentguard entry.
- **Audit DB is WAL-mode SQLite.** Fine for a single writer (the proxy). Don't open it from multiple processes for writes.
