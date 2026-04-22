# Changelog

Notable user-visible changes. Not every internal refactor appears here — see the commit log for full history.

## Unreleased

### Added
- `agentguard policy preset observe|cautious|deny-all` — named policy postures with backup-before-overwrite and `--dry-run`. New users get a safe baseline in one command.
- `agentguard doctor` — operational health check with 5 checks (proxy-reachable, audit-db-writable, downstream-reachable, openclaw-pointed-at-us, node-version). Flags: `--only`, `--skip`, `--fix`, `--json`. Exit code = number of failures.
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
