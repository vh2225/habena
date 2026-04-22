# Changelog

Notable user-visible changes. Not every internal refactor appears here — see the commit log for full history.

## Unreleased

### Added
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

---

## Prior history

See commit log. This changelog starts with the public-readiness work in 2026-04.
