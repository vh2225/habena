# Habena

> **Keep your AI agent on a short rein.**

[![CI](https://github.com/vh2225/habena/actions/workflows/ci.yml/badge.svg)](https://github.com/vh2225/habena/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/habena)](https://www.npmjs.com/package/habena)

**Website:** [habena.3app.studio](https://habena.3app.studio) · an open-source project by [3app.studio](https://3app.studio)

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

Requires Node 20+.

**Install** from npm:

```bash
npm i -g habena
```

(Or run any command ad hoc with `npx habena@latest <command>`. To hack on the source instead: clone the repo, `pnpm install`, `pnpm -F habena build`, then `npm link` from `packages/core`.)

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

**Or approve from the browser.** The local dashboard serves a live decision stream, the approvals queue, agents, spend, your policy, and a setup wizard:

```bash
habena dashboard    # http://localhost:7700 (first run downloads habena-web)
```

**Point your assistant at Habena.** For OpenClaw, the installer wires Habena in as the MCP proxy (it backs up your existing config and validates paths first):

```bash
habena install openclaw
```

## Talk to your agent

Habena isn't only a gate for tool calls — it can carry your side of the conversation too. Point it at your OpenClaw gateway and a chat panel shows up next to the approvals queue, backed by the same policy, audit log, and rate limits as everything else.

**Enable it.** In `~/.habena/config.yaml`:

```yaml
chat:
  enabled: true
  bridge:
    token_env: OPENCLAW_GATEWAY_TOKEN   # env var holding the gateway token — never inline it in config.yaml
```

Restart the proxy to pick it up:

```bash
habena start
```

**Chat from the dashboard.** `habena dashboard` gets a `/chat` page: type a message, watch the reply stream in, and allow or deny any tool call it triggers inline, without switching to `habena watch`.

**Chat from Telegram.** The same bot that taps your phone for approvals can take commands too — turn on inbound, nested under the same `chat:` block (not the top-level approval `channels:`):

```yaml
chat:
  enabled: true
  channels:
    telegram:
      inbound: true
```

> **The safety model for inbound chat.** A channel that can talk to your agent
> is a channel that can be abused, so three guards hold it back. A per-channel
> rate-limit breaker trips on a burst of messages and rejects everything from
> that channel until you run `habena chat rearm telegram` (`habena chat
> status` shows what's disarmed). A **Telegram policy floor** holds any run
> that started from a Telegram message to at least the `cautious` preset,
> merged stricter-of-two with your own policy — Telegram can't talk its way
> into a looser rule than your config allows, though your policy can still
> deny it outright. And simplest of all: **commands from your phone can only
> be approved from your Mac** — a write or destructive call triggered from
> Telegram shows up for approval on the web dashboard or `habena watch`,
> never as a button inside Telegram itself. Your phone can ask; only your Mac
> can say yes.

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

> **Phone-tap approvals work today.** Point Habena at a Telegram bot and a held
> call buzzes your phone: an agent hits a `require_approval` rule → your phone
> buzzes → tap **⛔ Deny** → the call is blocked and audited. Only your own
> chat id can approve, and the choices are Allow-once / Deny. Setup is a few
> lines of config — see
> [docs/approval-channels.md](https://github.com/vh2225/habena/blob/main/docs/approval-channels.md).
> The `habena watch` CLI (and raw IPC) still work alongside it.

**Panic button.** Something looks wrong and you want everything stopped *now*:

```bash
habena lockdown on     # every tool call is denied until you release it
habena lockdown off
```

From your phone, the same Telegram bot accepts `/lockdown`, `/resume`, and `/status` (owner-only, like approval taps). And session approvals are inspectable: `habena session list` shows every active `allow_session` grant with its time left; `habena session revoke <id>` kills one early.

## Status & roadmap

**Early, working, single-operator tested.** Habena is public because it's more useful to others than sitting on a laptop, not because it's production-grade. It's MIT licensed with no paid tier, no gated features, and no open-core split. Install with `npm i -g habena` ([npmjs.com/package/habena](https://www.npmjs.com/package/habena)).

Today: stdio MCP transport only; approvals via CLI/IPC, one-tap Telegram, or the local web dashboard (`habena dashboard` → `localhost:7700`: live decision stream, approvals queue, agents, spend, policy viewer, and a setup wizard).

> **Local heuristic threat detection works today.** Habena scans downstream MCP
> tools for tool-poisoning (suspicious tool-description patterns), rug-pulls
> (tool-definition drift — checked between runs *and* mid-session on a periodic
> re-scan), and credential-egress (secrets in call args). Detection is
> heuristic/best-effort and runs entirely on your machine — no cloud feed. Each
> detector defaults to `require_approval` and is configurable via the `threat:`
> block in `config.yaml` (`off` | `warn` | `require_approval` | `block`; the
> re-scan cadence via `rescan_interval`, default `10m`).

> **What the budget block actually enforces.** Habena sits between the agent
> and its tools, not between the agent and its LLM, so it never sees token
> bills directly. Three honest mechanisms instead: `budget.calls`
> (`per_minute`/`per_hour`/`per_day`) hard-denies past a call count — the cap
> that stops a looping agent. `budget.result_tokens` caps the estimated tokens
> tool results inject into the agent's context (the measurable driver of LLM
> spend) — also a hard deny. Dollar limits (`daily`, `monthly`, `per_session`,
> `per_request`) enforce against `pricing:` — USD-per-call you declare for
> metered tools; since declared prices are a guess, overruns warn by default
> (`on_exceed: deny` or `require_approval` to block/escalate). For true dollar
> caps on LLM spend itself, put an LLM gateway with budgets (e.g. LiteLLM) in
> front of your model API — Habena and a gateway compose cleanly.

Roadmap:

- **Provider-side cost ingestion** — pull real LLM spend from provider usage APIs / gateways and attribute it per agent, on top of the declared per-tool pricing that ships today.
- **Cloud-backed threat intel** — shared signatures for known-bad servers, layered on the local heuristic detection that already ships.
- **Mac guarded-sandbox recipe** — a documented, locked-down setup for running an assistant under Habena on macOS.

Full design: [`docs/plans/2026-06-08-habena-design.md`](https://github.com/vh2225/habena/blob/main/docs/plans/2026-06-08-habena-design.md).

## License

MIT — see [LICENSE](LICENSE).

An open-source project by [3app.studio](https://3app.studio).
