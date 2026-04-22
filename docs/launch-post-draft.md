# Launch post drafts (for your eyes — not public)

A few angles. Pick one based on where you post. Polish tone to taste before shipping.

---

## Show HN (preferred)

**Title:** `Show HN: AgentGuard – MCP middleware that makes AI agents safer and more automated`

**Body:**

```
Hi HN — I've been running AI agents (OpenClaw, mostly) against my own
email, calendar, and short-term rental business for a few weeks, and
got tired of either over-restricting them (useless) or not restricting
them enough (scary). Built AgentGuard as the middle layer.

Repo: https://github.com/vh2225/agentguard  (MIT)

An agent connects to AgentGuard as its MCP server. AgentGuard forwards
every tool call to the real MCP servers downstream, running it through
a policy engine, cost budget, and optional human approval. Every
decision is audited to SQLite.

One command to get a safe baseline:

  agentguard init
  agentguard downstream add gmail     # guided OAuth
  agentguard start

`agentguard policy preset cautious` writes a rule set that allows
reads, requires approval for writes, hard-denies destructive ops. The
config is a YAML file you can edit, but you don't have to start with
YAML — the preset is the first-use story.

`agentguard doctor` catches most of the silent misconfigurations I
hit personally while building this: better-sqlite3 ABI mismatches,
OpenClaw pointing at a deleted binary, downstream MCP servers that
started but can't authenticate, audit DB unwritable, etc. Example
output from my machine right now:

  ✓ proxy-reachable          hello in 2ms
  ✓ audit-db-writable        1.2 MB, 4,822 rows
  ⚠ downstream-reachable     gcal: auth token expired
      └─ fix: Re-run the downstream's auth flow or re-issue its token
  ✓ openclaw-pointed-at-us   points at the current install path
  ✓ node-version             Node v20.12.2, better-sqlite3 loads
  ✓ clock-skew               +0s vs google.com
  ✓ approval-queue-draining  no pending approvals

Thesis: the middle layer is how you get safer AND more automated at
the same time, not either alone. Observe what agents do, turn the
stable patterns into rules, keep humans in the loop for the long tail.

Status: early, single-operator tested. Chat-channel approvals are
spec'd but not built. Learning-mode (observe → propose rules) is
stubbed. Fleet/dashboard is a local-only Next.js scaffold. Everything
on the roadmap is MIT, no gated tier — goal is adoption.

Would love pointers to people solving the same problem, or holes in
the thesis. Happy to answer anything.
```

---

## Reddit — r/LocalLLaMA

**Title:** `I built a middleware proxy so my local agents stop doing dumb things`

Shorter, less buttoned-up than HN. Link to repo. Show 3-screenshot flow: Telegram DM → agent → approval prompt → reply. Emphasize local-first, open source, no paid tier.

---

## Reddit — r/selfhosted

**Title:** `AgentGuard: self-hostable safety layer for MCP-based AI agents`

Lead with the "everything stays on your machine" angle. SQLite audit log, config in ~/.agentguard/, systemd service file shipped. Call out that it works behind a firewall / air-gapped, no telemetry.

---

## X / Twitter thread

Eight tweets max. Structure:

1. "Spent a month building an MCP middleware proxy. Shipped today: MIT, adoption-first, no paid tier. Thread → github.com/vh2225/agentguard"
2. Why: agents getting powerful faster than safe; every project picks ONE of (safer, more automated) — I wanted both.
3. Architecture diagram (the one in the README).
4. Demo of policy preset → start → doctor in screenshots.
5. The three design pieces I think matter: scope-based policy (not rule-regex), auth-probe for downstreams, doctor command that catches silent misconfigs.
6. What's NOT done: chat-channel approvals, learning mode, multi-user. Invite contributors.
7. Credits: /cc @obra for superpowers, which was the reason I trusted the "build in public" path.
8. Repo link again, honest ask: "tell me what I got wrong."

---

## General cross-post notes

- Post times: HN Tuesday 8-10am PT. Reddit any weekday mid-morning.
- HN: use "Show HN" prefix and a clear demo link — not just a GitHub URL. If you can include a 30-second asciicinema or similar showing the install/doctor flow, use it.
- Keep the thesis (safer AND automated) front-and-center. "Yet another MCP tool" won't hold attention.
- Don't over-promise. The "what's missing" section in the README is a feature — honest about early-stage status + invites contribution.
- Respond to every comment in the first 4 hours. This is how HN / Reddit stories get traction.
- Track where traffic comes from — GitHub's Insights → Traffic shows referrers for 14 days.
