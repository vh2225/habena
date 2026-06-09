# Habena

> **Keep your AI agent on a short rein.**

[![CI](https://github.com/vh2225/agentguard/actions/workflows/ci.yml/badge.svg)](https://github.com/vh2225/agentguard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Habena is the open-source safety layer that sits between your AI assistant (OpenClaw, Hermes, any Claude-based agent) and the real MCP servers and tools it calls. It enforces a policy engine, spend caps, and one-tap human approval on every tool call, and audits every decision to SQLite — so a runaway loop can't drain your wallet, a poisoned tool can't quietly exfiltrate your secrets, and nothing dangerous happens without your say-so. Install an assistant and guard it end-to-end. Mac-first.

> **Renamed from AgentGuard.** The `agentguard` command and the `~/.agentguard/` config directory still work as deprecated aliases — nothing breaks. New installs use `habena` and `~/.habena/`; an existing `~/.agentguard/` is detected automatically.

**Status: early, working, single-operator tested.** MIT, no paid tier. Not yet recommended for production fleets.

---

## Why

LLM agents are getting powerful faster than they're getting safe. Three things that have already happened to real people:

- **Tool poisoning.** A poisoned MCP tool description was used to exfiltrate a Cursor user's `~/.ssh/id_rsa` — the malicious instructions lived in the tool metadata, invisible in the normal UI. ([Invariant Labs](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks))
- **Rug-pull / backdoored server.** Even a "trusted" server can turn on you: a tool can present a benign description at approval time, then silently change its behavior afterward (a "rug pull"), or ship an outright backdoor — like an official MCP server that BCC's every outbound email to its maintainer. ([Invariant Labs](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks))
- **Cost runaway.** Always-on agents loop. There are reports of $1,000+ surprise bills from runaway agent loops — no cap, no off switch, no one watching.

Habena is the layer that catches these — policy + approval + spend cap + audit, in front of every tool call.

## How it works

```
Agent (OpenClaw/…) → Habena (policy · budget · approval · audit) → real MCP servers (filesystem, gmail, …)
```

Your agent connects to Habena as its single MCP server. Habena inspects every tool call, applies your policy, logs the decision, and either forwards the call to the real downstream server, holds it for human approval, or blocks it. Allowed calls pass through transparently; everything else stops at the gate.

## Quickstart (60 seconds)

Requires Node 20+ and pnpm.

**Install.** `npm i -g habena` is the goal, but **the npm package is not published yet.** Until it is, install from source:

```bash
git clone https://github.com/vh2225/agentguard.git
cd agentguard
pnpm install
pnpm -F habena build
cd packages/core && npm link
```

**Initialize.** Creates `~/.habena/config.yaml` seeded with the safe `cautious` preset (allow read/list, require approval for writes and destructive ops, deny the rest):

```bash
habena init
```

**Add a downstream you can reproduce — the filesystem server**, rooted at a directory of your choosing:

```bash
habena downstream add filesystem ~/workspace
```

**Register an agent + daily budget:**

```bash
habena agent add --name openclaw --budget-daily 30
```

**Start the proxy** (stdio transport):

```bash
habena start
```

**Approve from the terminal.** In a second terminal, run the interactive approval queue. When a rule returns `require_approval`, the tool call pauses and waits here until you allow or deny it:

```bash
habena watch
```

**Point your assistant at Habena.** For OpenClaw, the installer wires Habena in as the MCP proxy (it backs up your existing config and validates paths first):

```bash
habena install openclaw
```

## The demo (what makes it click)

This runs end to end with only the commands above and the default `cautious` policy — no custom YAML needed. The `cautious` preset already requires approval for writes and destructive operations.

1. **Set up.** `habena init`, then `habena downstream add filesystem ~/workspace`, then `habena start`.
2. **Watch.** In a second terminal: `habena watch`.
3. **Trigger.** Your agent (or a test MCP client) asks the filesystem server to write or delete a file under `~/workspace`. Because the `cautious` preset marks writes/deletes as `require_approval`, Habena does **not** forward the call — it holds it.
4. **Decide.** The held call appears in `habena watch`. Deny it.
5. **Confirm it was blocked and recorded:**

```bash
habena logs --decision require_approval
```

Every allow, deny, and held call is written to the SQLite audit log, queryable with `habena logs` (filter with `--agent`, `--last 24h`, `--decision`, `--limit`).

> **Phone-tap approvals (Telegram one-tap Allow/Deny) are coming next.** Today, approvals come through the `habena watch` CLI (or raw IPC) — not yet a chat channel.

## Status & roadmap

**Early, working, single-operator tested.** Habena is public because it's more useful to others than sitting on a laptop, not because it's production-grade. It's MIT licensed with no paid tier, no gated features, and no open-core split. The npm package is not published yet — install from source for now.

Today: stdio MCP transport only; approvals via CLI/IPC; a v0 read-only web decision stream.

Roadmap:

- **Phone-tap approvals** — one-tap Allow/Deny from Telegram.
- **Onboarding wizard + dashboard** — guided setup and a real approval/config UI.
- **MCP threat firewall** — detection for rug-pulls and tool-poisoning (tool-description drift, known-bad servers).
- **Mac guarded-sandbox recipe** — a documented, locked-down setup for running an assistant under Habena on macOS.

Full design: [`docs/plans/2026-06-08-habena-design.md`](https://github.com/vh2225/agentguard/blob/main/docs/plans/2026-06-08-habena-design.md).

## License

MIT — see [LICENSE](LICENSE).

An open-source project by [3app.studio](https://3app.studio).
