# Changelog

Notable user-visible changes. Not every internal refactor appears here — see the commit log for full history.

## Unreleased

### Added
- **`agentguard policy explain`** — trace which rule would match a tool call against the loaded policy (user rules + host-policy floor). Takes a JSON blob (`'{"tool":"x","args":{...}}'`) or `--tool`/`--args` flags. `--json` emits machine-readable output. No proxy restart, no side effects. Closes the last explicit item on the Phase 8 spec.
- **Host-policy floor** — `~/.agentguard/host-policy.yaml` now loads as a strict floor the user's `config.yaml` cannot weaken. Engine takes the stricter-of-two when both a host rule and a user rule match a call (`deny` > `require_approval` > `allow`; `hard_mandatory` > `soft_mandatory` > `advisory`). Supports `extends:` to pin a preset floor. Hard boundaries and session overrides still take priority over host-policy, same as before. Completes Phase 8 V3.
- **Local web dashboard** — live view of decisions at http://localhost:7700. Reads `~/.agentguard/audit.db` read-only and polls for new rows every 2s. Shows total allow/deny/approval counts and a rolling table of the last 100 decisions (agent, tool, server, decision, tier, rule, latency). Run with `pnpm --filter @agentguard/web dev`. First slice of Phase 6.
- **Rule packs** — six shipped packs (`gmail-readonly`, `gmail-draft-only`, `filesystem-readonly`, `filesystem-write-approval`, `github-no-push`, `slack-readonly`) under `packages/core/rule-packs/`. Import via `extends:` in `config.yaml`; user-authored packs live at `~/.agentguard/rule-packs/` and override shipped ones. Managed via `agentguard packs list|show <name>`. First slice of Phase 8 V2.
- `agentguard learn` — reads the audit DB, buckets tool calls by `(agent_type, tool)`, and proposes a least-privilege rule set. Suggests `allow` for tools consistently allowed, `deny` for ones consistently denied, `require_approval` for mixed. `--write` emits YAML you can paste into `config.yaml`. `--days`, `--agent`, `--json` flags. Never proposes to weaken a hard-boundary match. First slice of Phase 10 (observe → propose rules).
- `agentguard approvals list|respond|forward` — thin IPC-client subcommands so you can script the approval flow without the interactive `watch` TUI.
  - `list [--json]` prints pending approvals one-shot.
  - `respond <id> <choice> [--duration-ms …] [--note …]` resolves one programmatically.
  - `forward --url <URL> [--hmac-secret …]` streams every `approval_request` as a signed HTTP POST to a webhook — point it at Zapier, Discord, ntfy, your own endpoint. First slice of Phase 7 chat-channel forwarding.
- `agentguard downstream add filesystem <path>` — one-command setup of the filesystem MCP server (auto-registers an `auth_probe` of `list_allowed_directories`).
- `agentguard downstream add gmail` — interactive OAuth flow for `@antidrift/mcp-gmail`. Prompts for Google OAuth client credentials (or accepts `--client-id` / `--client-secret`), walks the user through the browser consent step, exchanges the code for tokens, saves them at the path the MCP expects, optionally `npm install -g`s the package, and registers the server in `config.yaml` with an `auth_probe` of `gmail_list_labels`. Replaces ~4 manual steps.
- `agentguard downstream list` / `agentguard downstream remove <name>` for managing downstream entries without hand-editing YAML.
- `agentguard policy preset observe|cautious|deny-all` — named policy postures with backup-before-overwrite and `--dry-run`. New users get a safe baseline in one command.
- `agentguard doctor` — operational health check with 7 checks (proxy-reachable, audit-db-writable, downstream-reachable, approval-queue-draining, openclaw-pointed-at-us, node-version, clock-skew). Flags: `--only`, `--skip`, `--fix`, `--json`. Exit code = number of failures.
- Boot-time doctor subset runs in background during `agentguard start`; prints warnings on non-pass checks.
- Optional `auth_probe: {tool, args?}` per `mcp_servers` entry — AgentGuard calls the probe at startup and reports `authenticated` / `auth_failed` / `unchecked` instead of only checking process liveness.
- `agentguard install openclaw` now aborts if the absolute binary path it would write doesn't exist on disk.
- GitHub Actions CI on Node 20 and 22.

### Changed
- Startup banner replaces `Downstreams N/N alive` with `Downstreams N/N healthy`, and per-server rows now include auth state (`authenticated`, `auth unchecked`, or `⚠ auth failed: …`).
- `pnpm.onlyBuiltDependencies` declared in root `package.json` so `better-sqlite3` native binding builds reliably on fresh installs.

### Fixed
- 20 pre-existing test failures caused by missing `better-sqlite3` native binding on Node 22; suite now runs 156/156 on a fresh `pnpm install`.

### Security
- Pre-launch review addressed. See commit history + `SECURITY.md` for detail.
  - `respond` IPC now ACKs — prevented a silent-success bug where a non-owner on a shared socket could try to resolve unknown approval IDs and the sender would never know.
  - Webhook HMAC envelope is now Stripe-style `t=<unix>,v1=<hex>` with a separate `X-AgentGuard-Timestamp` header so receivers can reject replays.
  - Audit-log args capped at 64 KB with a structured truncation marker — prevents a broken downstream from ballooning the SQLite DB.
  - `extractAuthCode` regex tightened to match Google's real code shape, not arbitrary path-like strings.
  - Webhook forwarder now bails after 5 consecutive POST failures instead of retrying indefinitely.

---

## Prior history

See commit log. This changelog starts with the public-readiness work in 2026-04.
