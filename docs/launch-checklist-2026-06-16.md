# Habena Launch Checklist - 2026-06-16

Purpose: turn the existing launch draft into an executable launch pass.

## Launch Position

Habena should launch as:

> The open-source safety proxy for MCP-based AI agents: policy, approvals, audit, runaway-loop caps, and local threat detection before tool calls run.

Do not lead with "agent framework" or "MCP server." Lead with the controlled failure demo: an agent tries something risky, Habena pauses it, the owner denies it, and the audit log proves what happened.

## Preflight

- [ ] `npm view habena version` matches the README/roadmap version.
- [ ] Fresh install path works on a clean machine or clean user profile:
  - `npm i -g habena`
  - `habena init`
  - `habena downstream add filesystem ~/workspace`
  - `habena agent add --name openclaw --budget-daily 30`
  - `habena start`
  - `habena dashboard`
- [ ] `habena.3app.studio` returns `200`.
- [ ] GitHub README first screen has: problem, architecture diagram, 60-second quickstart, honest limits.
- [ ] Dashboard screenshot is current.
- [ ] Telegram approval screenshot is current, with secrets/chat ids hidden.

## Demo To Record

Target: 60-90 seconds.

1. Show architecture: Agent -> Habena -> filesystem MCP.
2. Trigger a write outside allowed scope.
3. Show the call held in `habena watch` or dashboard.
4. Deny from Telegram or dashboard.
5. Show structured denial and audit log.
6. Run `habena policy explain shell_execute --args '{"command":"rm -rf /"}'`.

## Threat Matrix To Add To README

| Threat | What happens | Habena control | Proof to show |
| --- | --- | --- | --- |
| Tool poisoning | Malicious instructions hidden in tool metadata | Tool-description heuristics, require approval/block modes | Threat badge + audit evidence |
| Rug pull | Tool definition changes after approval/startup | Definition drift scan across restarts and mid-session | `tools/list_changed` notification / audit event |
| Credential egress | Secret appears in tool args | Secret scan, redacted evidence, default require approval | Denied call with redacted evidence |
| Runaway loop | Agent repeatedly calls tools | Call-rate and result-token caps | Budget/call counter denial |
| Human-in-the-loop gap | Risky write/delete runs too fast | `require_approval`, CLI/browser/Telegram queues | Held call -> deny -> audited |

## Posts

Use `docs/launch-post-draft.md` as the copy source. Recommended order:

1. Show HN.
2. r/LocalLLaMA.
3. r/selfhosted.
4. X thread with the demo clip.

Track after posting:

- GitHub stars, clones, and referrers.
- npm package downloads.
- Issues/questions by theme.
- Which threat or workflow commenters actually care about.

## Do Not Claim

- Do not claim production-fleet readiness.
- Do not claim guaranteed MCP security.
- Do not claim true LLM dollar caps unless provider-side cost ingestion is actually wired.
- Do not imply cloud threat intel exists today.

## Next Product Work If Launch Gets Pull

1. Reproducible attack-demo fixtures in `examples/`.
2. Provider-side cost ingestion.
3. Richer threat-alerts page.
4. Registry trust integrations.
5. Process fingerprinting for agent identity.
