# AgentGuard Roadmap

Living progress tracker. Update when phases start and finish. Detailed phase plans live in `docs/plans/`.

Last updated: 2026-04-22.

## Status key

- ✅ Shipped — merged to `main`, covered by tests.
- 🔨 In progress — has a branch / spec / plan.
- 🧭 Next — queued, not started.
- 💤 Later — agreed scope, no committed timeline.

---

## Done

### ✅ Phase 1 — Core MVP
Plan: `docs/plans/2026-04-09-phase1-core-mvp.md`
Scope: Policy engine, cost tracker, budget enforcer, audit logger, identity registry + instances, approval queue (in-memory), CLI skeleton (`init`, `start`, `agent`, `logs`). Unit-test coverage for pure-logic modules.

### ✅ Phase 2 — Transparent forwarding
Spec: `docs/specs/2026-04-10-phase2-transparent-forwarding.md`
Plan: `docs/plans/2026-04-10-phase2-transparent-forwarding.md`
Scope: `DownstreamManager` + `DownstreamClient`, per-server failure isolation, tool namespace collision handling, `createMcpServer` wrapping the dispatcher, `tools/list` aggregation, E2E forwarding test against real `@modelcontextprotocol/server-filesystem`.

### ✅ Phase 3a — Approval backend
Spec: `docs/specs/2026-04-10-phase3a-approval-backend.md`
Plan: `docs/plans/2026-04-10-phase3a-approval-backend.md`
Scope: Unix-socket IPC with NDJSON protocol, `agentguard watch` CLI with inquirer prompts, `allow_once` / `allow_session` / deny flows, 5-minute default approval timeout, E2E approval test with real proxy subprocess.

### ✅ Phase 4 — Install command
Scope: `agentguard install openclaw` / `agentguard uninstall openclaw` — migrates stdio MCP servers out of `~/.openclaw/openclaw.json` into `~/.agentguard/config.yaml`, replaces AgentGuard's entry with a single proxied `agentguard` server, writes timestamped backups, validates the target binary path exists before writing.

### ✅ Downstream auth probe (Phase 9 prep)
Scope: optional `auth_probe: {tool, args?}` per `mcp_servers` entry. Dogfooding against the Mac-mini lab revealed that `Downstreams N/N alive` reported healthy even when a downstream couldn't authenticate. Now each downstream can declare a cheap read-only probe; at startup, AgentGuard calls it and reports `authenticated`, `auth_failed`, or `unchecked`. Three new tests; no config changes required for existing deployments (unchecked = previous behavior).

### ✅ Phase 9 V1 — `agentguard doctor`
Spec: `docs/specs/2026-04-15-phase9-doctor-and-audit.md`
Scope: operational health-check command with 5 checks — proxy-reachable (IPC hello ping), audit-db-writable (open + schema check + test write + rollback), downstream-reachable (reuses auth-probe output), openclaw-pointed-at-us (validates paths actually exist on disk), node-version (>=20 + better-sqlite3 ABI compatibility). Flags: `--only`, `--skip`, `--fix`, `--json`. Exit code = number of failures. Wired into `agentguard start` boot so misconfigurations surface before the first tool call.

### ✅ Policy presets (Phase 8 V1 slice)
Scope: `agentguard policy preset observe|cautious|deny-all`. Three named postures with backup-before-overwrite and `--dry-run`. New users get a safe baseline in one command without authoring rule YAML. Deliberately not in this slice: host-policy floor, rule pack imports, named scopes — the larger Phase 8 story.

### ✅ Downstream onboarding (`downstream add`)
Scope: `agentguard downstream add filesystem <path>`, `agentguard downstream add gmail` (guided OAuth flow that prompts for client creds or accepts flags, walks the user through the browser consent step, exchanges the code, saves tokens at the MCP's expected path, auto-installs the npm package, registers the server with a matching `auth_probe`). Plus `downstream list|remove`. Closes the third dogfood finding (2026-04-21).

### ✅ Phase 7 V0 — approvals list/respond/forward
Scope: three thin IPC-client subcommands — `approvals list [--json]`, `approvals respond <id> <choice>`, and `approvals forward --url <URL> [--hmac-secret S]` streams approval events as signed webhooks (Zapier / Discord / ntfy / custom). End-to-end tested with a real proxy + inline HTTP receiver. Full Phase 7 (scope-bound inbound remotes, two-channel confirmation, circuit breakers) stays spec'd for V1.

### ✅ Phase 10 V0 — `agentguard learn`
Scope: reads the audit DB, buckets tool calls by `(agent_type, tool)` over a rolling window, proposes `allow` / `deny` / `require_approval` rules based on observed decision history. `--write` emits YAML the user can review and paste into `config.yaml`. Never proposes to weaken a hard-boundary match. This is the observation loop the product thesis hinges on — safer AND more automated by learning from real behavior, not guessing up front.

---

## Next

### 🧭 Phase 5 — Lab validation (in motion)
Runbook: `docs/runbooks/mac-mini-lab-setup.md`
Owner: Vinh.
Goal: end-to-end validation of the full proxy against OpenClaw on a physically isolated Mac mini. Not product code — integration confidence.

Phases inside the runbook:
- Phase 0–2 — backup, wipe, prepare encrypted external SSD.
- Phase 3–5 — host tools, OrbStack Ubuntu VM, AgentGuard + OpenClaw wiring.
- Phase 6 — observe mode smoke (every tool call hits the audit log).
- Phase 7 — enforced mode with deny-default (5-test validation: allow, approval, hard deny, prompt-injection via file content, budget exhaustion).
- Phase 8 — progressive tool expansion (fetch → git → sqlite).
- Phase 9 — burner identity + test Slack workspace.
- Phase 10 — optional Claude API for code-dev tests, budget-gated.
- Phase 11 — chaos / red-team.

Exit criteria: phase 7 five-test flow passes twice in a row from a clean `agentlab-baseline` snapshot; no silent allows on the red-team pass.

### 🧭 Phase 6 — Observability for operators
Rationale: the lab exposes it — `agentguard logs` tailing works but there's no single glance at "what is the agent doing right now, what's it been denied for today, how much budget is left." Before asking teams to run this against real agents, we need the dashboard.

Scope sketch:
- ✅ `packages/web` live decision feed — `pnpm --filter @agentguard/web dev` at localhost:7700 (polls `audit.db` every 2s, shows last 100 decisions + allow/deny/approval totals).
- Per-agent budget gauge + daily spend breakdown.
- Approval UI in the web dashboard as an alternative to the tmux `watch` pane (headless-host story).

Not included: cloud hosting, multi-tenant, auth. Local-only.

### 🧭 Phase 7 — Chat channels (inbound + outbound)
Spec: `docs/specs/2026-04-15-phase7-chat-channels.md`
Rationale: hands-off operation breaks in both directions — when approvals only reach a terminal, and when the user has no way to command an agent from their phone. One channel registry serves both: outbound approvals to Slack + inbound commands from Signal, with per-remote scope binding, two-channel confirmation for irreversible actions, rate-limit circuit breakers, and an SMS-is-never-a-command-transport rule enforced at config parse.

### 🧭 Phase 8 — Policy presets + rule packs
Spec: `docs/specs/2026-04-15-phase8-policy-presets-and-rule-packs.md`
Rationale: new users currently get `allow *` after `agentguard init` — the opposite of safe. Ship `agentguard policy preset observe|cautious|deny-all`, add a `host-policy.yaml` floor that the config can't weaken (stricter-of-two merge), and four built-in rule packs (`filesystem-readonly`, `filesystem-write-approval`, `github-no-push`, `slack-readonly`) importable via `extends:`.

### 🧭 Phase 9 — `doctor` + `security audit`
Spec: `docs/specs/2026-04-15-phase9-doctor-and-audit.md`
Rationale: Phase 5 lab surfaced the "silent misconfiguration" failure mode (better-sqlite3 ABI mismatch, OpenClaw not actually pointed at us, stale approval queue after watcher died). `doctor` runs eight operational checks with actionable fix hints; `security audit` does static analysis over the resolved policy to flag unreachable rules, weakened hard boundaries, and missing approval forwarders.

### 🧭 Phase 10 — Policy profiler end-to-end
`learning/` scaffolding exists. `agentguard learn --agent X` needs to: read the audit log in observe mode, cluster tool-call shapes, emit a least-privilege draft `rules:` block the user can diff against. Complements phase 8's preset/rule-pack story — presets give a safe floor, the profiler closes the loop so users can auto-generate the custom rules above that floor instead of writing them by hand. (Was Phase 7.)

### 🧭 Phase 11 — Threat feed MVP
`threat/` module exists. Need: a signed feed URL, periodic sync (cron inside the proxy), a tier-0 "blocked downstream server" list (fingerprints of known-malicious MCP servers from Smithery/Glama reports), antivirus-style version pinning. (Was Phase 8.)

---

## Later

### 💤 Registry integrations
Official MCP registry, Smithery, Glama wired into the CLI for discovery + install (`agentguard install <server-from-registry>`). Requires registry clients in `registry/` to mature beyond scaffolding.

### 💤 Hosted fleet view
Multi-agent fleet view, team approvals, alert routing, compliance exports. If demand materialises, this could run as a separate deployment (docker-compose reference) — not a gated paid tier. AgentGuard itself is fully open source.

### 💤 Non-stdio transports
HTTP / SSE / streamable-http downstream support. `DownstreamClient` is stdio-only. Installer already preserves HTTP servers untouched in OpenClaw's config, precisely because we can't proxy them yet.

### 💤 Conditional rules
`policy/engine.ts` already has `deny_if` / `deny_unless` action types in `normalizeAction` but evaluates them as plain `deny` today (comment at `engine.ts:111-117`). Wire the condition-expression evaluator.

### 💤 Multi-agent coordination
Today each MCP connection is one agent instance. Multi-agent fleets (e.g. supervisor + workers) share a proxy but currently also share audit attribution. Needs instance propagation via MCP connection headers.

---

## Known drift from spec

Tracked here so the spec doesn't silently diverge further. See `docs/architecture.md` → *Drift from the spec* for details.

- Policy evaluation is first-match-wins per tier, not "deny-overrides-allow."
- Tier order is hard boundaries → session overrides → user rules → defaults → implicit deny (spec had these out of order).
- Cloud / threat / registry components are scaffolded, not end-to-end.

When we ship phase 6 or phase 11, update the spec in the same PR or mark it superseded.

---

## How to update this file

- Moving an item between sections → change the heading + status emoji, keep history visible in git.
- Adding a new phase → append under `🧭 Next`. If it has a plan doc, link it. If it's vague, write "scope sketch" and resist pretending it's planned.
- Completing a phase → move under `## Done`, link the plan + spec, one-line scope summary.
- Don't rename sections. External docs (architecture.md, runbooks) link here.
