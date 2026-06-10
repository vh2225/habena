# Habena Architecture

Engineer onboarding doc. Assumes you know what MCP is. Pair this with `docs/plans/2026-06-08-habena-design.md` (product framing) and the phase plans in `docs/plans/` (implementation history). Renamed from AgentGuard 2026-06; the `agentguard` binary and `~/.agentguard/` remain as deprecated aliases.

Last updated: 2026-06-10 (v0.4.0).

## What Habena is, in one sentence

A stdio MCP server that impersonates the MCP servers an agent wanted to talk to, intercepts every `tools/call`, and enforces policy + threat detection + budgets + human approval before forwarding — with every decision audited to SQLite.

## The data path

```
┌──────────┐  stdio/MCP   ┌──────────────── Habena proxy ───────────────────┐   stdio/MCP   ┌────────────┐
│  Agent   │ ◄──────────► │  McpServer (proxy/server.ts createMcpServer)    │ ◄────────────►│ filesystem │
│ (Open-   │              │    └─ ProxyDispatcher.handleToolCall()          │               │  gmail     │
│  Claw)   │              │        1. resolve declared per-tool price       │               │  …         │
│          │              │        2. BudgetEnforcer.check()        ─┐      │               └────────────┘
└──────────┘              │        3. PolicyEngine.evaluate()        ├─ stricter() merge
                          │        4. ThreatEngine.checkCall()      ─┘      │
                          │        5. ApprovalQueue.request() (if required) │
                          │        6. AuditLogger.log() (every decision)    │
                          │        7. CostTracker.record() + authorize      │
                          │  DownstreamManager owns all child MCP clients   │
                          │  (auto-restart w/ backoff; periodic re-scan)    │
                          └───────────┬─────────────────────────────────────┘
                                      │ IPC (unix socket)
                       ┌──────────────┼───────────────────┐
                       ▼              ▼                   ▼
               ┌───────────────┐ ┌──────────────┐ ┌──────────────────┐
               │ habena watch  │ │ Telegram bot │ │ habena dashboard │
               │ (terminal)    │ │ (one-tap)    │ │ (localhost:7700) │
               └───────────────┘ └──────────────┘ └──────────────────┘
```

Everything in `packages/core/src/` maps to one of those boxes; `packages/web/` is the dashboard (published separately as `habena-web`).

## Read-these-first files

If you only have 30 minutes, read these four in order:

1. **`policy/engine.ts`** — the security model. The header comment is load-bearing; read it verbatim.
2. **`proxy/server.ts` — `ProxyDispatcher.handleToolCall`**. The whole system's contract: pricing → budget → policy → threat (all merged via `stricter()`) → approval → audit → spend.
3. **`threat/engine.ts`** — scan-time + call-time threat checks and why flags are sticky.
4. **`downstream/manager.ts`** — how child MCP servers are spawned, indexed, isolated, refreshed, and respawned.

## Module reference

### `proxy/` — the hot path

Two classes, deliberately split:

- **`ProxyDispatcher`** is pure logic. Takes a `ToolCallRequest`, returns a `ToolCallResult`. No transports, no child processes — this is what unit tests hit. Decisions from budget, policy, and threat are combined with `stricter()` (exported by `policy/engine.ts`): a stricter source can only escalate, never loosen. This closed a real hole — a budget `require_approval` must never bypass a policy deny.
- **`createMcpServer`** is the MCP protocol adapter. Implements `ListTools` + `CallTool`, advertises `tools.listChanged` (the catalog can change mid-session after a downstream refresh). On `allow` it forwards via `DownstreamManager` and meters the result size (see cost). On non-allow it returns a structured error to the agent.

### `threat/` — local detection, no cloud

Four detectors, each independently configurable (`off | warn | require_approval | block`, default `require_approval`):

- **`tool-poisoning.ts`** — heuristics over tool *descriptions* (prompt-injection cues, exfiltration instructions, zero-width chars).
- **`credential-egress.ts`** — secrets in call args (AWS keys, GitHub tokens, PEM blocks…). Iterative, bounded walk; fails closed.
- **`snapshots.ts`** — rug-pull/drift: tool-definition hashes compared across runs *and* mid-session (`threat.rescan_interval`, default 10m, re-fetches downstream catalogs and re-scans).
- **`signatures.ts`** — optional local feed (`threat.feed_file`): known-bad server names, tool-name patterns, description substrings.

`ThreatEngine.scanTools()` runs at startup and on each re-scan; `checkCall()` runs per call. Scan flags are **sticky for the session** — after a drift the new definition becomes the snapshot baseline, so clearing flags on a clean re-scan would silently unflag a rug-pulled tool. Evidence strings are redacted (`match:<id>`, never the secret). Warn-mode findings are carried onto the final allow decision so they reach the audit log.

### `downstream/` — child MCP server fleet

`manager.ts` is the supervisor:

- `start()` spawns every configured server in parallel with **per-server failure isolation**.
- `refresh()` re-fetches tool lists (driven by the threat re-scan interval); a failing server keeps its cached catalog — stale-but-known beats empty.
- `restartServer()` respawns a dead downstream with exponential backoff (also kicked off in the background after a failed forward). The old client is stopped only after its replacement is up, because `stop()` clears the cached tool list.
- Namespace collisions auto-prefix (`server/tool`); config can force a prefix.

`DownstreamClient` is the per-child wrapper — spawn, MCP handshake, tool cache, optional `auth_probe`.

### `policy/` — the decision engine

A tiered, first-match-wins evaluator. The header comment in `engine.ts` documents the model; the short version:

1. **Hard boundaries** (built-in, always win — cannot be overridden).
2. **Session overrides** (from `allow_session` approvals, time-limited).
3. **Host-policy floor + user rules** (stricter-of-two when both match).
4. **Default rules** (built-in fallbacks).
5. **Implicit deny** (fail-safe).

**Within a tier, first match wins** (iptables / security-groups model) — **not** "deny-overrides-allow." Order rules intentionally: specific denies before broad allows.

Conditional rules **work**: `deny_unless` allows when its `condition` block holds and denies otherwise; `deny_if` is the inverse. Conditions share the `match` field vocabulary, `~` expands in path prefixes, and anything unevaluable (missing/empty condition, reserved fields) **fails closed**.

Other files: `matcher.ts` (predicates, shared by `match` and `condition`), `decisions.ts` (the structured `PolicyDecision` — never collapse it to a boolean), `built-in-rules.ts` (the non-negotiable deny list), `packs.ts`/`presets.ts` (rule packs + `observe|cautious|deny-all`), `audit.ts` (`security audit` static analysis).

### `approval/` — human-in-the-loop

`queue.ts` turns a `require_approval` decision into a blocking `await` (default 5 min timeout). Outcomes: `allow_once`; `allow_session` (also pushes a time-limited session override); decline/timeout/no-watcher → deny. Channels: `habena watch` (terminal over IPC), the web dashboard, and `channels/telegram.ts` (owner-only one-tap Allow/Deny with callback allowlisting and one-shot consume; also owner text commands `/lockdown` `/resume` `/status`).

Operator controls over the same IPC socket: **lockdown** (`habena lockdown on|off` — an engine-level kill switch that outranks every tier) and **session-approval management** (`habena session list|revoke` — `allow_session` grants carry ids, are visible with their remaining time, and can be revoked early).

### `cost/` — what budgets actually enforce

Habena proxies tools, not the LLM, so it never sees token bills. Three honest mechanisms (see `cost/tool-pricing.ts` header):

- **Call-count limits** (`budget.calls`) — rolling per-minute/hour + calendar-day caps per agent type. Hard deny. The runaway-loop guard.
- **Result-token limits** (`budget.result_tokens`) — caps the estimated tokens tool results inject into context (~serialized length / 4, metered in `createMcpServer` after each forward). Hard deny.
- **Dollar limits** (`daily`/`monthly`/`per_session`/`per_request`) — enforce against `pricing:`, user-declared USD-per-call. Because declared prices are a guess, overruns follow `on_exceed` (default **warn**; `deny`/`require_approval` opt in). `alert_at` percent thresholds alert once per limit/threshold/agent.

Per-agent overrides from `agents.yaml` (`agent add --budget-daily`) merge over the global config. Counters **survive restarts**: spend/calls hydrate from the audit log at startup; result-token readings write through to the `result_meter` table. `CostTracker` keeps the current month in memory and prunes older records.

### `audit/` — forensic log

WAL-mode SQLite, single writer (the proxy). One row per decision: timestamp, agent, instance, tool, args (truncated at 64KB), server, decision, tier, rule, reason, cost, latency, result status. Threat-driven decisions carry a `threat:<detector>` reason — that string is how the dashboard counts threat flags. Plus the `result_meter` table for token metering.

**Ops note:** keep the audit DB on a different physical drive from the agent's scratch data — an agent that compromises its workspace must not be able to delete its own audit trail.

### `identity/` — who is calling

Two-level: **agent type** (permissions + budget, registered via `habena agent add`) and **instance** (per-connection, lazy-created; session overrides and per-instance spend attach here). The connection's agent type comes from the `HABENA_AGENT` env var (legacy `AGENTGUARD_AGENT` honored). Process fingerprinting is roadmap — today identity is declarative.

### `learn/` — least-privilege proposals

`analyzer.ts` reads the audit DB, buckets calls by `(agent, tool)`, and proposes `allow`/`deny`/`require_approval` rules from observed history (`habena learn`). Never proposes weakening a hard boundary. This is the product thesis: safer AND more automated by learning from real behavior.

### `cli/` — commander thin wrapper

`init`, `start`, `dashboard`, `watch`, `logs`, `agent`, `approvals`, `downstream`, `policy` (presets/explain/audit), `packs`, `security`, `learn`, `doctor`, `install`/`uninstall`. All domain logic lives in the modules above; commands are assembly only. `doctor` runs 7 operational checks with fix hints; a boot-time subset runs inside `start`.

### `packages/web/` — the dashboard (`habena-web` on npm)

Next.js app at `localhost:7700`: overview, live decisions (threat badges, deep-linkable filters), approvals queue (resolve from the browser), agents, spend (call volume, result tokens, declared dollars), policy viewer, setup wizard, ⌘K palette. Read-only against `audit.db` + the IPC socket; **secret-safe by construction** (channel names only, never tokens). Published with a prebuilt `.next` (webpack — Turbopack externals don't survive install) and launched via `habena dashboard` → `npx habena-web`.

## Invariants to keep in your head

- **Decisions only ever escalate.** Budget, policy, and threat results merge via `stricter()`; nothing later in the pipeline can loosen an earlier deny.
- **Hard boundaries cannot be overridden.** Not by user rules, not by session approvals.
- **Session approvals can bypass user denies** — explicit, human-in-the-loop.
- **Implicit deny is the floor.** An empty config still fails safe.
- **Measured data blocks; guessed data warns.** Call counts and result tokens hard-deny; declared-pricing dollar overruns default to warn.
- **Threat flags are sticky for the session.** Re-scans add, never remove.
- **Conditions fail closed.** Unevaluable conditional rules deny.
- **Audit logs every decision**, allow and deny, with the threat reason carried through (including warn-mode).
- **One failing downstream doesn't fail the proxy** — and it gets respawned with backoff.
- **`PolicyDecision` is structured, not boolean.** Consumers need tier/reason/enforcement/rule for UX and audit.

## Testing

- ~355 core tests + ~87 web tests. `pnpm test` per package (`test` = `tsc && vitest run` — always build first; CLI tests execute the real `dist/` binary against isolated HOMEs).
- No mocked filesystem — `tests/downstream/manager.test.ts` spawns real MCP servers; e2e tests spawn the real proxy.
- CI runs on Node 20/22 (`.github/workflows/ci.yml`).

## Common extension points

- **New downstream server** — `mcp_servers:` in `~/.habena/config.yaml` (or `habena downstream add`). No code change.
- **New policy rule / pack / preset** — config, `rule-packs/`, or `policy/presets.ts`.
- **New threat detector** — module in `threat/`, a `DetectorId`, a mode field on `ThreatConfig`, wire into `ThreatEngine.scanTools`/`checkCall`.
- **New built-in hard boundary** — `policy/built-in-rules.ts`. Security-sensitive; expect review.
- **New CLI command** — file in `cli/commands/`, register in `cli/index.ts`.
- **New decision field** — touch `policy/decisions.ts` and `audit/types.ts` together; the audit schema must match.

## Things to know that aren't obvious from the code

- **Two processes is the normal setup.** The proxy is attached to the agent's stdio; approvals arrive in `habena watch`, the dashboard, or Telegram.
- **The `learn` flow is the intended onboarding path** for a new agent — observe, profile, tighten — not hand-writing rules.
- **`habena install openclaw` writes a timestamped backup** on every run; uninstall restores the latest.
- **The dashboard ships separately** (`habena-web`) because it carries the Next.js runtime; the CLI stays a 137KB package.
- **Rename compat is everywhere on purpose**: `agentguard` bin, `~/.agentguard/`, `AGENTGUARD_*` env, `agentguard.sock` all still work so existing deployments don't break.
