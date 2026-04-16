# Phase 7 — Chat Channels (Inbound + Outbound) Design Spec

**Date:** 2026-04-15
**Status:** Draft (supersedes `2026-04-15-phase7-approval-forwarding.md`)
**Depends on:** Phase 3a approval backend (shipped), Phase 4 install command (shipped)

## Goal

Make AgentGuard work over the chat channels the user already lives in — both directions. The product thesis is hands-off operation after check-and-balance. That breaks the moment the user has to SSH in to answer a prompt (outbound approvals) or reach a laptop to give the agent a task (inbound commands). The same transport layer solves both problems.

Two flows, one channel registry:

- **Outbound:** pending approval → posted to Slack/Signal/Discord → user taps Allow / Deny → decision flows back.
- **Inbound:** user sends "draft a reply to Smith about the lease" from Signal → bound agent runs → output returns on the same channel.

## Problem

Today the approval queue is reachable only via `agentguard watch` (TTY) or direct Unix-socket IPC. Today the proxy has no concept of a "remote command transport" at all — commanding an agent means being at a terminal.

OpenClaw already solved the channel-plumbing side (see `/usr/local/lib/node_modules/openclaw/docs/tools/exec-approvals.md` and the broader channel adapters). We adopt the same pattern but impose an enforcement layer on top: every inbound command from a channel must clear AgentGuard's scope check before OpenClaw executes it, and every approval is posted out through the same adapter registry.

## Transport safety — the core constraint

Not every chat transport is safe for commanding an agent. The spec bakes the ranking in:

| Channel | Suitable for inbound commands | Suitable for outbound notifications |
|---|---|---|
| Signal | ✓ (recommended default) | ✓ |
| iMessage (BlueBubbles) | ✓ | ✓ |
| Discord / Slack with 2FA | ✓ (team ops) | ✓ |
| Telegram / WhatsApp | low-privilege only (phone-number auth, SIM-swap risk) | ✓ |
| Plain SMS | **never** (unauthenticated, trivially spoofable, SIM-swap) | ✓ |
| Email | **never** (trivially spoofable) | ✓ (for confirmation codes, see below) |

AgentGuard enforces this by refusing to grant any inbound scope to an SMS/email transport at config-parse time.

## Architecture

```
                           ┌─────────────────────┐
  Inbound command          │  Channel Adapter    │          Outbound approval
  "draft reply..."  ──▶    │  (Signal/iMsg/...)  │   ◀── "Approve write to /x?"
                           └─────────┬───────────┘
                                     │
                                     ▼
                           ┌─────────────────────┐
                           │   RemotesRegistry   │  binds channel+sender → scopes
                           │   ScopeGate         │  clears inbound before dispatch
                           │   ForwardingHub     │  routes outbound approvals
                           └─────────┬───────────┘
                                     │
                      ┌──────────────┼──────────────┐
                      │                             │
                      ▼                             ▼
           ┌────────────────────┐      ┌────────────────────┐
           │ OpenClaw agent run │      │  ApprovalQueue     │
           │  (bounded scopes)  │      │  (Phase 3a)        │
           └────────────────────┘      └────────────────────┘
```

Every channel adapter is both a sender and a receiver. The `RemotesRegistry` is the source of truth for which chat identities can do what.

## Design

### Config schema

One `remotes` block handles both directions:

```yaml
# ~/.agentguard/config.yaml
remotes:
  signal-vinh:
    adapter: signal
    sender: "+15551234567"              # bound sender; others denied
    direction: [inbound, outbound]      # both flows
    inbound:
      route_to_agent: triage            # which agent receives commands
      scopes:                           # what the agent may do for this remote
        - gmail:read
        - calendar:read
        - calendar:propose
        - re-research:read
        - "*:draft-only"                # never send/publish/pay from this remote
      rate_limit:
        commands_per_10min: 10
        high_privilege_per_hour: 5
    outbound:
      post_approvals_to: self           # DM the bound sender
      shortcuts:
        allow_once: "👍"
        deny: "❌"

  slack-team:
    adapter: slack
    direction: [outbound]               # approvals only; no command inbound
    outbound:
      post_approvals_to:
        - channel: "#agent-approvals"
        - user: "U012ABC3D"
      allow_respondents: ["U012ABC3D"]
```

### Scopes (not raw rules)

An inbound remote grants **scope names**, not rule-match patterns. Scopes are defined in the phase-8 rule-packs spec and referenced here. A scope bundles a set of tool patterns + resource constraints. The proxy rejects a command if any tool call it would issue falls outside the union of granted scopes.

### Confirmation for irreversible actions

Any scope carrying `*:send`, `*:publish`, `*:pay`, or `*:delete` semantics requires a **two-channel confirmation**. The command arrives on channel A; the confirmation code is delivered on channel B (the user's registered email or secondary transport). The agent cannot proceed until the code is echoed back on channel A within 10 minutes.

```
[signal in]   "book UA237 SFO 10am"
[signal out]  "Confirm by replying the code I just emailed you. Expires in 10 min."
[email]       code=4821
[signal in]   "4821"
[agent]       proceeds with gmail:send (or whatever tool)
```

Rationale: a SIM-swapped phone reaches Signal but not the user's email in the same window. An email-compromise doesn't get the initial command privilege. Both must fall for the attacker to forge an irreversible action.

Config:

```yaml
remotes:
  signal-vinh:
    confirmation:
      required_for_scopes: ["*:send", "*:publish", "*:pay", "*:delete"]
      second_channel: email-vinh        # reference another remote of kind: email
      timeout_ms: 600000
```

Email transport for confirmation is allowed only as a **second factor**, never as an inbound command transport on its own.

### Circuit breakers

- `rate_limit.commands_per_10min` exceeded → channel auto-disarms (inbound denied) until user re-arms via a distinct action (e.g., run `agentguard remotes rearm signal-vinh` from a terminal or the web dashboard). Catches pwned-phone command floods.
- `rate_limit.high_privilege_per_hour` exceeded → same, but only on scopes needing confirmation.
- `quiet_hours: { from: "01:00", to: "05:00", tz: "America/Los_Angeles" }` (optional) → inbound denied during sleep hours. Catches both hijacks and agent loops that keep the user awake.
- Heartbeat: each outbound-capable remote posts a status line to its channel every N hours (user-configured). Silence = visible alert that something stopped working.

### Denial cache-invalidation (carryover from prior draft)

A `deny` decision — whether from a manual approval response or an exhausted-scope inbound command — records `(agent_id, session_id, tool_call_signature)` in a per-session denial set. Subsequent matching calls in the same session auto-deny with `reason: prior_deny_this_session`. Agents cannot wear the user down or loop past a denial.

### Adapter interface

```ts
interface ChannelAdapter {
  name: string;
  directions: ("inbound" | "outbound")[];
  start(): Promise<void>;                          // connect, subscribe
  sendApproval(approval: PendingApproval, target: DeliveryTarget): Promise<Receipt>;
  sendNotification(text: string, target: DeliveryTarget): Promise<Receipt>;
  onInboundCommand(handler: InboundHandler): void; // emits parsed commands
  shutdown(): Promise<void>;
}

interface InboundCommand {
  remoteName: string;
  sender: string;
  text: string;
  messageId: string;      // for in-channel reply threading
  receivedAt: Date;
}
```

Each adapter owns its own transport (HTTP webhook for Signal REST, BlueBubbles socket for iMessage, etc). The hub normalizes them.

## V1 scope (ship this)

- **Signal adapter** as the reference implementation. Bidirectional. Uses `signal-cli` or signald under the hood.
- **Slack adapter** for outbound team-scale approvals. Unidirectional (outbound only).
- **RemotesRegistry + ScopeGate** — config-driven binding of sender identity → scopes.
- **Two-channel confirmation** with email as the second factor.
- **Rate-limit circuit breaker** on `commands_per_10min` and `high_privilege_per_hour`.
- **Denial cache-invalidation** invariant.
- CLI: `agentguard remotes list|rearm|test`.

## Out of V1

- iMessage (BlueBubbles), Discord, Telegram, WhatsApp, Matrix adapters — each is additive once Signal is the reference.
- Multi-approver quorum ("2 of 3 admins must approve before send").
- Escalation chains (primary → secondary after N seconds silence).
- Geofence / IP-based circuit breakers. Quiet-hours is the V1 proxy for presence.
- Rich replies (inline forms, attachments, file previews) on the outbound side.

## Open questions

1. **Should Signal run inside `agentguard start` or as a separate daemon?** The BlueBubbles-style model is a separate bridge daemon; the Slack-style model is embedded. Leaning separate for Signal because the phone-registration + Perfect Forward Secrecy state is finicky and should not share a process with the tool proxy. Slack stays embedded.
2. **What's the default behavior when the second-channel confirmation times out?** Deny. But should the command auto-retry when the user later echoes the code? Proposal: no — expired codes require re-issuing the command. Treating timeouts as "resume when you answer" is an ambiguity window.
3. **Do we need `remotes` support for fully-unauthenticated channels** (public Discord channel, RSS feed)? Proposal: no in V1. If V2 demands it, such a remote gets `direction: [outbound]` forced and `scopes: []`.
4. **Should scopes themselves be transitive across remotes?** E.g., if `signal-vinh` grants `*:draft-only` and the draft is later approved via `slack-team`'s outbound flow, is the send execution attributed to which remote? Proposal: attribute to the **approver's** remote in the audit log, but enforce the **initiator's** scope envelope. Prevents a weak-channel command from being laundered into a strong-channel approval.

## Success criteria

- **Inbound path:** user DMs Signal bot "list my top 5 unread emails." AgentGuard audits the command with the Signal sender id, grants scope `gmail:read`, bounded agent runs, result returned on Signal. All ≤5s p95.
- **Outbound path:** agent running on cron drafts an email to an unknown recipient. AgentGuard intercepts `gmail_send`, requires approval, posts to both `signal-vinh` (DM) and `slack-team` (channel). Whichever responds first wins; the other gets "already resolved." Audit row captures approver identity + adapter + latency.
- **Confirmation flow:** user sends command requiring `gmail:send-to-anyone` via Signal. Agent requests confirmation, code emailed, user echoes back on Signal within 10 min. Executes. Dev-test also covers the negative path (wrong code → deny, logged).
- **Circuit breaker:** scripted burst of 20 commands in 1 min trips the rate limit. Inbound denied. `agentguard remotes list` shows channel as `disarmed`. Re-arm via CLI, commands flow again.
- **No operator hand touches a terminal** during any successful happy path.
