# Habena Roadmap

Living progress tracker. Update when phases start and finish. Detailed phase plans live in `docs/plans/`; the implementation history below keeps the original phase names (and the pre-rename `agentguard` command names) for traceability.

Last updated: 2026-06-10 (v0.4.0 on npm).

## Status key

- ✅ Shipped — merged to `main`, covered by tests.
- 🧭 Next — queued, not started.
- 💤 Later — agreed scope, no committed timeline.

---

## Done

### ✅ Phase 1 — Core MVP
Policy engine, cost tracker, budget enforcer, audit logger, identity registry + instances, approval queue (in-memory), CLI skeleton (`init`, `start`, `agent`, `logs`).

### ✅ Phase 2 — Transparent forwarding
`DownstreamManager` + `DownstreamClient`, per-server failure isolation, namespace collision handling, `tools/list` aggregation, E2E against the real filesystem MCP server.

### ✅ Phase 3a — Approval backend
Unix-socket IPC (NDJSON), `watch` CLI, `allow_once`/`allow_session`/deny flows, approval timeouts.

### ✅ Phase 4 — Install command
`install openclaw` / `uninstall openclaw` with timestamped backups and path validation.

### ✅ Phases 8/9/10 (V1 slices) — presets, packs, host-policy, explain, doctor, learn
Policy presets (`observe|cautious|deny-all`), `extends:` rule packs (six shipped), host-policy floor (stricter-of-two), `policy explain` (accepts a bare tool name), `security audit` static analysis, `doctor` (7 checks + boot subset), `learn` (audit history → least-privilege rule proposals), downstream onboarding (`downstream add filesystem|gmail`), `approvals list/respond/forward` (signed webhooks).

### ✅ Rename → Habena (2026-06)
npm `habena`, repo `vh2225/habena`. `agentguard` bin, `~/.agentguard/`, `AGENTGUARD_*` env all remain working deprecated aliases.

### ✅ Phone-tap approvals (Telegram)
In-proxy `TelegramApprovalChannel`: owner-only auth, callback allowlist, one-shot consume, pre-timeout warning. The outbound half of the chat-channels story.

### ✅ Threat firewall (local, no cloud)
Four detectors, each `off|warn|require_approval|block` (default require_approval): tool-poisoning (description heuristics), credential-egress (secrets in args; fails closed), rug-pull (definition drift — across restarts *and* mid-session via `rescan_interval` re-scan with `tools/list_changed` notification), and a local signature feed (`threat.feed_file`: known-bad servers / tool patterns / description substrings). Secret-redacted evidence; sticky session flags; warn-mode findings reach the audit log.

### ✅ Conditional rules
`deny_unless` / `deny_if` evaluate their `condition` block (same vocabulary as `match`, `~` expansion in paths). Unevaluable conditions fail closed.

### ✅ Honest budgets
Call-count limits (rolling windows; the runaway-loop guard), result-token limits (metered tool-result size), declared per-tool `pricing:` powering the dollar limits (`on_exceed` warn by default, `alert_at` thresholds), per-agent overrides from `agents.yaml`, counters that survive proxy restarts (audit-log hydration + `result_meter`).

### ✅ Web dashboard (`habena dashboard` → localhost:7700)
Overview, live decision stream (threat badges, deep-linkable filters), approvals queue (resolve in the browser), agents, spend (calls/tokens/declared dollars), policy viewer, 5-step setup wizard, ⌘K palette. Secret-safe API layer. Published as `habena-web`; launched via `habena dashboard`.

### ✅ Downstream resilience
Auto-restart with exponential backoff on death (refresh-triggered + after failed forwards); failed respawns keep the cached catalog.

### ✅ npm packages
`habena` + `habena-web` published (0.4.0), install-from-tarball verified, CI green on Node 20/22.

---

## Next

### 🧭 Launch
Demo recording + Show HN / r/LocalLLaMA posts. Kit ready at `docs/launch-post-draft.md`.

### 🧭 Provider-side cost ingestion
Pull real LLM spend from provider usage APIs / gateways (LiteLLM, OpenRouter) and attribute per agent, on top of declared per-tool pricing. Makes the dollar limits enforce on measured data.

### 🧭 Inbound chat commands (Phase 7 V1)
Outbound approvals ship (Telegram). The inbound half — commanding agents from your phone with per-remote scope binding, two-channel confirmation for irreversible actions, rate-limit circuit breakers — stays spec'd at `docs/specs/2026-04-15-phase7-chat-channels.md`.

### 🧭 Richer threat-alerts surface
Basic visibility ships (overview card, threat-filtered decisions). A dedicated page with severity/scope grouping and ack/snooze is the next dashboard increment.

---

## Later

### 💤 Registry integrations
Official MCP registry, Smithery, Glama wired into discovery + install + rule matching (`registry:`/`glama_grade:` predicates). Clients in `registry/` are stubs.

### 💤 Process fingerprinting
Agent identity is declarative today (`HABENA_AGENT`). Verify the connecting process against a registered binary hash / process tree.

### 💤 Hosted fleet view
Multi-agent fleet view, team approvals, alert routing, compliance exports — as a self-hostable deployment, not a paid tier. Habena stays fully open source.

### 💤 Non-stdio transports
HTTP / SSE / streamable-http downstream support. `DownstreamClient` is stdio-only; the installer deliberately leaves HTTP servers untouched in OpenClaw's config.

### 💤 Multi-agent coordination
Supervisor/worker fleets currently share audit attribution per connection. Needs instance propagation via MCP connection metadata.
