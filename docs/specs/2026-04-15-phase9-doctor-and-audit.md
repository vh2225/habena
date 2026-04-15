# Phase 9 — `doctor` and `security audit` Design Spec

**Date:** 2026-04-15
**Status:** Draft
**Depends on:** Phase 1 Core MVP, Phase 3a approval backend, Phase 4 install command

## Goal

Detect silent failures and misconfigurations that would otherwise go unnoticed until a real incident. A misconfigured AgentGuard that passes every tool call through without enforcement is worse than no AgentGuard — the user thinks they're safe when they aren't. We need one command that answers "is this actually working?" and another that answers "are my rules actually protecting me?"

Two separate commands because the failure modes are separate:

- `agentguard doctor` — operational health. Is the proxy running, reachable, writing audit rows, talking to downstream servers?
- `agentguard security audit` — policy correctness. Are any rules unreachable? Is a hard boundary accidentally set to `advisory`? Is `deny-all` defeated by a wildcard `allow` earlier in the list?

## Problem

Phase 5 lab validation kept surfacing "I thought this was wired, why is nothing being intercepted?" class bugs — better-sqlite3 ABI mismatch, OpenClaw still pointing at stdlib filesystem MCP, pending approvals silently auto-denying after the watcher died. Every one of those manifested as "nothing happens," and every one of them would be caught by a focused check.

Meanwhile, the policy engine's first-match-wins semantics mean an early overly-broad rule can silently invalidate a later specific one. A user who writes `*: allow` at the top has effectively disabled every deny below it, and the engine gives no warning. This is a *correctness* problem, not an operational one — the system is working exactly as configured; the configuration is wrong.

## Architecture

Both commands are pure-function CLI subcommands that read state and report — they don't mutate anything. Each check is an independent `Check` record so the CLI can `--json` output for CI, and individual checks can be run with `--only <name>` or skipped with `--skip <name>`.

```
┌──────────────────────┐
│ agentguard doctor    │──▶ runs N operational Checks
└──────────────────────┘       │
                               ▼
                    ┌──────────────────────┐
                    │ each Check returns   │
                    │   { name, status,    │
                    │     detail, fixHint} │
                    └──────────────────────┘
                               │
                               ▼
                    CLI groups by status
                    (pass/warn/fail) and prints
                    exit code = number of failures

┌──────────────────────┐
│ agentguard security  │──▶ static analysis over resolved policy
│ audit                │    (config + host + packs, fully expanded)
└──────────────────────┘
```

## Design

### `doctor` checks (V1)

| Name | What it verifies | Fix hint on fail |
|---|---|---|
| `proxy-running` | `agentguard start` process alive and listening on the IPC socket. | Run `agentguard start` (or check `systemctl --user status`). |
| `ipc-socket` | `~/.agentguard/agentguard.sock` exists, is a socket, is readable. Tries a no-op NDJSON ping. | Proxy isn't running or user mismatch. |
| `audit-db-writable` | Can open `audit.db`, can insert + delete a test row, fsync survives. | Check disk space + file permissions on `~/.agentguard/`. |
| `approval-queue-draining` | No entries in the queue older than `2 × timeout_ms`. | Stale entries usually mean a crashed `watch` — run it again or enable forwarding. |
| `downstream-reachable` | For each `mcp_servers` entry in `config.yaml`, spawn it with `--help` or send an `initialize` MCP frame; record success/fail per server. | Package missing, command path wrong, or server crashed on launch. |
| `openclaw-pointed-at-us` | If `~/.openclaw/openclaw.json` exists, its MCP server named `agentguard` actually points at our binary. | Run `agentguard install openclaw --force`. |
| `node-version` | Runtime is Node 20+, and for the package specifically, native deps (`better-sqlite3`) load without ABI mismatch. | `npm rebuild better-sqlite3 --build-from-source`. |
| `clock-skew` | Host clock is within 5 seconds of `pool.ntp.org` (or similar). Audit rows with wild timestamps are hell to reason about. | Fix NTP. Warning, not failure. |

Each check has an `auto_fix` field. If set and the user passes `--fix`, the CLI attempts the remediation (e.g., `npm rebuild`). Never auto-fixes anything destructive; never writes to `config.yaml` or `host-policy.yaml` from `doctor`.

### `security audit` checks (V1)

Static analysis over the *resolved* policy (after expanding `extends`, merging host-policy, applying defaults):

| Name | What it flags |
|---|---|
| `hard-boundary-weakened` | Any rule that targets a built-in hard boundary with `enforcement: advisory` or `soft_mandatory`. |
| `unreachable-rule` | Any rule that cannot fire because an earlier rule in the same tier already matched its entire pattern. |
| `wildcard-before-specific` | `tool: "*"` with `allow` appearing before any specific `deny` in the same tier — classic self-own. |
| `missing-deny-fallthrough` | Tier ends with no explicit `*: deny` and relies on implicit deny — OK, but warn so the user knows. |
| `require-approval-no-forwarder` | Any `require_approval` rule when `approvals.forward` is unconfigured — approvals would default to terminal-only and silently timeout. |
| `host-policy-overridden-attempt` | Any user rule that *tries* to weaken a host-policy rule (not actually dangerous because the engine enforces stricter-of-two, but worth surfacing because it usually means the user is confused). |
| `orphan-server-reference` | Rules matching a `server: <name>` that isn't in `mcp_servers:`. Usually a typo. |

Output like a linter: file + line (when we know it) + severity + a one-line explanation. `--json` for CI gating.

### `doctor` output shape

```
AgentGuard health report (2026-04-15 14:22 PDT)
───────────────────────────────────────────────
  ✓ proxy-running                 pid 14822, 2h uptime
  ✓ ipc-socket                    readable, 3ms roundtrip
  ✓ audit-db-writable             42MB, 18k rows
  ✗ downstream-reachable          slack server failed to start
      └─ exec: npx @modelcontextprotocol/server-slack exited 1
      └─ fix: check SLACK_BOT_TOKEN in env
  ⚠ approval-queue-draining       1 pending approval, 47m old
      └─ was `watch` closed before it resolved?
  ✓ openclaw-pointed-at-us        ~/.openclaw/openclaw.json OK
  ✓ node-version                  v20.12.2, native deps load
  ✓ clock-skew                    +0.8s vs pool.ntp.org

1 failed, 1 warning, 6 passed
Exit: 1
```

## V1 scope

- `agentguard doctor` with all eight checks above, `--json` output, `--only`/`--skip` filters, `--fix` for `node-version` only (safest auto-fix).
- `agentguard security audit` with all seven checks, `--json` output, file+line location when the rule source is a pack or specific line of config.yaml.
- Unit tests per check. Smoke test in the lab runbook: intentionally break each property, confirm the check flags it.

## Out of V1

- `doctor --watch` continuous mode. The web dashboard (Phase 6) is the right place for that.
- Remediation wizard that walks a user through fixing each flag interactively. Nice-to-have.
- Performance profiling (slow rules, pathological regex). Defer until a user complains.

## Open questions

1. Should `doctor` run automatically at `agentguard start` boot and refuse to start if critical checks fail? Proposal: print results, refuse to start only on `audit-db-writable` or `ipc-socket` failures. Others are warnings.
2. Is `security audit` strict enough to block `agentguard start` when run from a CI gate, or is it only advisory? Proposal: advisory by default; a `--strict` mode that exits nonzero on any warning, used by CI.
3. Should the `require-approval-no-forwarder` check be a `doctor` item (operational) instead of an `audit` item (policy)? It straddles both — leaning `audit` because it's about whether policies can actually fire as intended.

## Success criteria

- After an intentional sabotage of each check's invariant, `doctor` / `audit` flags it with actionable output. Lab runbook adds an explicit "sabotage drill" step.
- `doctor` + `audit` together catch every "silent misconfiguration" class bug seen in Phase 5 lab notes.
- CI usage: a downstream repo can run `agentguard security audit --strict --json` in a pre-merge check over a proposed config.yaml change.
