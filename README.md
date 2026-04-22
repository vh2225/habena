# AgentGuard

MCP middleware proxy that makes AI agents safer **and** more automated — not either alone.

An agent connects to AgentGuard as its MCP server; AgentGuard forwards tool calls to the real MCP servers downstream, enforcing a policy engine, cost budget, and human-approval queue on every call. Every decision is audited to SQLite. The thesis: once you've written the check-and-balance rules once, you should be able to run the agent hands-off.

**Status: early, working, single-operator tested.** Not yet recommended for production fleets.

---

## What it does

```
Agent (Claude, OpenClaw, etc)
      │
      ▼ one MCP connection
┌─────────────────────┐
│    AgentGuard       │   ← policy · budget · approvals · audit
└──────────┬──────────┘
           │ fans out
  ┌────────┼────────┐
  ▼        ▼        ▼
gmail    filesystem   sqlite   ...any MCP server
```

The agent sees a single MCP endpoint with every downstream tool available. AgentGuard gets to inspect every call, apply policy, log it, and optionally ask a human before forwarding.

## Why

LLM agents are getting powerful faster than they're getting safe. Most projects pick one axis: MCP clients add more tools to the agent (automation), security wrappers add more gates (safety). AgentGuard sits between them — the thesis is that observability + learning let you expand what an agent can do *without* expanding blast radius, because the rules are learned from observation rather than hand-written.

## Features

- **Three-tier policy engine.** Hard boundaries → session overrides → user rules → defaults → implicit deny. First-match within a tier, hard boundaries win across tiers.
- **Named policy presets.** `agentguard policy preset observe|cautious|deny-all` — one command for a safe baseline. No rule YAML required.
- **Transparent MCP forwarding.** Any downstream stdio MCP server can be wrapped. Tool-name collisions auto-namespace.
- **Auth probes at boot.** Each downstream can declare an `auth_probe` tool; AgentGuard calls it at startup and reports `authenticated`, `auth_failed`, or `unchecked`. No more "`N/N alive`" lies when a server is actually broken.
- **Human-in-the-loop approvals.** `require_approval` rules pause the tool call and wait for a human via `agentguard watch` (CLI) or an IPC client.
- **Cost tracking + budgets** per agent instance.
- **Structured audit log** in SQLite.
- **`agentguard doctor`.** Operational health check — detects misconfigured OpenClaw paths, ABI-mismatched native deps, unreachable downstreams, non-writable audit DB.
- **`agentguard install openclaw`.** One command to wire AgentGuard as OpenClaw's MCP proxy; backs up existing config, validates paths before writing.

## Install

Requires Node 20+ and pnpm.

```bash
git clone https://github.com/vh2225/agentguard.git
cd agentguard
pnpm install
pnpm -F @agentguard/core build
pnpm -F @agentguard/core link --global
```

Then:

```bash
agentguard init                        # creates ~/.agentguard/config.yaml
agentguard policy preset cautious      # safe default rule set
agentguard start                       # run proxy (stdio)
agentguard doctor                      # verify everything's healthy
```

To wire into OpenClaw:

```bash
agentguard install openclaw            # replaces OpenClaw's MCP servers with an agentguard proxy
openclaw gateway restart
```

## Quick tour

**See what policy presets look like:**

```bash
agentguard policy preset               # list all three
agentguard policy preset show cautious # preview the rule set
```

**Verify your setup:**

```bash
agentguard doctor
```

Sample output on a healthy install:

```
AgentGuard health report
────────────────────────
  ✓ proxy-reachable          hello in 2ms
  ✓ audit-db-writable        1.2 MB, 4,822 rows
  ✓ downstream-reachable     2/2 alive, 2 authenticated
  ✓ openclaw-pointed-at-us   openclaw.json → node /usr/lib/.../cli/index.js start
  ✓ node-version             Node v20.12.2, better-sqlite3 loads cleanly
```

**Watch approvals flow:**

```bash
agentguard watch   # in a separate terminal; interactive prompt on each require_approval
```

## Architecture

- [`docs/architecture.md`](docs/architecture.md) — high-level design
- [`docs/specs/`](docs/specs) — per-phase design specs (phases 1–4 shipped, 7–9 in progress)
- [`docs/roadmap.md`](docs/roadmap.md) — what's done, what's next
- [`packages/core/src/policy/engine.ts`](packages/core/src/policy/engine.ts) — policy evaluation (authoritative semantics, first-match-wins per tier)

## Development

```bash
pnpm install                              # installs + builds better-sqlite3 binding for your Node
pnpm -F @agentguard/core build            # typecheck + compile
pnpm -F @agentguard/core exec vitest run  # 156 tests, ~8s
```

CI runs on Node 20 and 22 on every push/PR.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: open an issue before starting substantial work so we don't duplicate effort.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities. AgentGuard sits in the authority chain between your agent and the outside world — treat it as security-sensitive infrastructure.

## License

MIT — see [LICENSE](LICENSE).
