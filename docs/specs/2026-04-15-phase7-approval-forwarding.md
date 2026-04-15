# Phase 7 — Chat-channel Approval Forwarding Design Spec

**Date:** 2026-04-15
**Status:** Draft
**Depends on:** Phase 3a approval backend (shipped), Phase 4 install command (shipped)

## Goal

Make AgentGuard approvals reachable from wherever the user already is. Today, `agentguard watch` is a TTY-only UX; once an operator closes the terminal or walks away, pending approvals sit and eventually auto-deny. That breaks the product thesis — the user can't be hands-off if they still have to SSH in and answer prompts.

A pending approval should show up in the user's chat channel (Slack first, others later), include the decision context, and let them approve or deny inline without opening a terminal.

## Problem

The approval queue resolves via a Unix-socket IPC — the `watch` CLI is the only first-class consumer. Any other consumer has to speak NDJSON over the socket, which is fine for scripts but meaningless to a human looking at Slack. We need a named transport: given a pending approval, deliver it to a configured channel, and accept a structured response from that channel to resolve it.

OpenClaw solved this already (see `/usr/local/lib/node_modules/openclaw/docs/tools/exec-approvals.md`). Key patterns to mirror:

- **Forwarding config lives at the approval layer**, not inside each channel config. `approvals.forward` owns "where does this go" separately from whatever other messaging the channel does.
- **Stable approval id is the correlation key.** Chat reply `/approve <id> allow-once` is the minimal protocol — no session tracking, no state on the channel side.
- **Denied approval invalidates cached output** for that tool-call signature in the same session — the agent cannot retry with a stale "last success" cache. We should enforce the same invariant even before we add any response cache, so retrofit is free later.

## Architecture

```
┌────────┐                    ┌─────────────────────┐
│ Agent  │──MCP tool call────▶│   ProxyDispatcher   │
└────────┘                    │  (Phase 3a as-is)   │
                              └──────────┬──────────┘
                                         │ require_approval
                                         ▼
                              ┌─────────────────────┐
                              │   ApprovalQueue     │──(unchanged)──▶ watch CLI
                              │                     │
                              │   ForwardingHub     │  NEW
                              └──────────┬──────────┘
                                         │
                      ┌──────────────────┼──────────────────┐
                      ▼                  ▼                  ▼
             ┌────────────┐    ┌────────────┐     ┌────────────┐
             │  Slack     │    │  Telegram  │     │  Generic   │
             │  adapter   │    │  adapter   │     │  webhook   │
             └──────┬─────┘    └─────┬──────┘     └─────┬──────┘
                    │                │                  │
                    ▼                ▼                  ▼
             Slack app          Telegram bot       POST JSON to URL
             (slash cmd,        (inline buttons)
              buttons)
```

The `ForwardingHub` subscribes to `approval_request` events on the queue, fans them out to enabled adapters, and listens for inbound callbacks that resolve via the existing `respond(id, response)` API.

## Design

### Config schema

Top-level `approvals` section in `~/.agentguard/config.yaml`:

```yaml
approvals:
  timeout_ms: 300000          # existing — shared default
  forward:
    - adapter: slack
      to:
        - channel: "#agent-approvals"
        - user: "U012ABC3D"      # DM fallback when channel is quiet
      allow_respondents:
        - "U012ABC3D"            # user ids allowed to approve
      shortcuts:
        reaction_allow: "white_check_mark"
        reaction_deny:  "x"
    - adapter: webhook
      url_env: AGENTGUARD_WEBHOOK_URL
      hmac_secret_env: AGENTGUARD_WEBHOOK_HMAC
```

`allow_respondents` is the safety interlock — even if the bot posts to a public channel, only listed identities can resolve. An unlisted user's `/approve` gets an ephemeral "not authorized" reply and a denial audit row.

### Adapter interface

```ts
interface ApprovalAdapter {
  name: string;
  send(approval: PendingApproval): Promise<DeliveryReceipt>;
  // inbound callbacks are registered by the adapter itself
  // (HTTP server, WebSocket, long-poll) and routed back to
  // hub.respond(id, response, { source: this.name, actor }).
  shutdown(): Promise<void>;
}
```

Each adapter owns its own inbound transport. The Slack adapter runs a `/agentguard approve` slash command + Block Kit buttons; webhook adapter exposes a signed `POST /agentguard/approval/:id` route on the existing HTTP mode (`agentguard start --http`).

### Hub responsibilities

- Deduplicate: one approval fans out to all adapters, but the first valid response wins. Late responses are rejected with a "already resolved" reply.
- Audit: every inbound response logs a row with `(approval_id, adapter, actor, decision, latency_ms)` so we can answer "who approved what and from where."
- Escalation (future): after `escalation_after_ms` with no response, optionally DM the primary user directly. Not in V1.

### Denial cache-invalidation invariant

Even in V1 without a response cache, `ProxyDispatcher` must record the `(agent_id, session_id, tool_call_signature)` tuple of any denied approval in a per-session denial set. Subsequent matching calls in the same session are auto-denied with `reason: prior_deny_this_session` and do not re-prompt. Rationale: an agent that retries the same call after a human deny is either looping or trying to wear the operator down — both should fail closed.

## V1 scope (ship this)

- Slack adapter only. Block Kit message with Allow-once / Allow-session / Deny buttons. Slash command `/agentguard approve <id> <choice>` as fallback.
- Webhook adapter (generic POST w/ HMAC) — the escape hatch for any other channel via Zapier/n8n/custom.
- `allow_respondents` enforcement.
- Denial cache-invalidation invariant.

## Out of V1

- Telegram, Discord, Matrix, iMessage adapters. Each ~2-3 days once the Slack one is the reference.
- Reaction shortcuts (👍 = allow_once). Add after button UX is solid.
- Escalation chains (primary → secondary after N seconds).
- Multi-approver quorum ("any 2 of 3 admins must approve").

## Open questions

1. Should the Slack adapter run embedded in `agentguard start` (adds an HTTP listener) or as a separate process (`agentguard approvals serve slack`)? Leaning embedded — one process to manage, matches `--http` mode.
2. How do we handle approval delivery when Slack is down? Queue locally and retry, or auto-deny? Proposal: retry for 30s, then fall through to whatever `on_unreachable: {deny|allow_watch_only}` says.
3. Do we need a "silent mode" where approvals are logged but never posted — useful during phase-6 observe runs? Probably yes; add `enabled: false` per adapter.

## Success criteria

- Lab validation: drop a file into the MCP-allowed workspace named `ignore-me-and-do-secrets.md`, instruct OpenClaw to read it and write a secret. AgentGuard detects the write tool call, posts to Slack, operator hits Deny from their phone, agent receives the denial, audit log row includes the Slack user id as the approver.
- End-to-end latency: p95 under 3s from tool call → Slack message visible.
- No operator hands touch a terminal during the entire validation.
