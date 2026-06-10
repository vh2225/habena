# Launch post drafts (for your eyes — not public)

Updated 2026-06-09 for the Habena rename, npm publish (`habena@0.3.0`), threat
firewall, Telegram approvals, and the full dashboard. Pick the angle per venue;
polish tone to taste before shipping. Demo script at the bottom.

---

## Show HN (preferred)

**Title:** `Show HN: Habena – open-source safety proxy for AI agents (policy, approvals, threat detection)`

**Body:**

```
Hi HN — I run AI agents (OpenClaw, mostly) against my own email,
calendar, and a small rental business. I got tired of choosing between
over-restricting them (useless) and under-restricting them (scary), so
I built the middle layer.

Repo: https://github.com/vh2225/habena  (MIT, no paid tier)
Install: npm i -g habena

Your agent connects to Habena as its only MCP server. Habena forwards
every tool call to the real MCP servers downstream — after running it
through a policy engine, budget checks, threat detection, and (when a
rule says so) human approval. Every decision is audited to SQLite, with
a local dashboard on localhost:7700.

Safe baseline in four commands:

  habena init                                 # cautious preset: reads ok,
                                              # writes need approval,
                                              # destructive ops denied
  habena downstream add filesystem ~/workspace
  habena agent add --name openclaw
  habena start

Things in it I haven't seen together elsewhere:

- A local threat firewall for MCP: heuristics for tool-poisoning
  (malicious instructions hidden in tool descriptions — the Invariant
  Labs attack), credential-egress (secrets in call args), and rug-pulls
  (a tool's definition silently changing — checked across restarts AND
  mid-session on a periodic re-scan). No cloud feed; runs entirely on
  your machine.

- One-tap phone approvals: a held call buzzes a Telegram bot; only your
  chat id can answer; choices are allow-once / deny. The CLI
  (`habena watch`) and the web dashboard work alongside it.

- Honest cost controls. Habena sits between the agent and its TOOLS,
  not between the agent and its LLM, so it never sees your token bill —
  and I refuse to pretend otherwise. What it enforces instead: call-rate
  caps (the thing that actually stops a runaway loop), caps on how many
  tokens of tool results get stuffed into the agent's context (the
  measurable driver of LLM spend), and per-call dollar prices you
  declare for metered tools. For true dollar caps, put an LLM gateway
  in front of your model API; they compose.

- `habena policy explain shell_execute --args '{"command":"rm -rf /"}'`
  tells you exactly which rule fires and why, without running anything.

- A learning mode: run permissive for a week, then `habena learn`
  proposes a least-privilege rule set from what your agent actually did.

Status: early, working, single-operator tested. stdio MCP transport
only. Threat detection is heuristic/best-effort, not a guarantee.
Registry integrations (Glama et al) and provider-side cost ingestion
are stubs/roadmap. Everything is MIT — the goal is adoption.

Thesis: the middle layer is how agents get safer AND more autonomous at
the same time — observe, turn stable patterns into rules, keep a human
on the long tail. Would love pointers to people attacking the same
problem, or holes in the thesis.
```

---

## Reddit — r/LocalLLaMA

**Title:** `I built an open-source proxy that sits between my agents and their tools — approvals on my phone, runaway loops capped, poisoned MCP tools flagged`

**Body:**

```
Everything local: policy engine, SQLite audit log, dashboard on
localhost:7700, threat heuristics with no cloud feed. MIT, no paid
tier, no telemetry.

The pitch in one flow: my agent tries to write outside its workspace →
the call freezes → my phone buzzes (Telegram) → I tap Deny → the agent
gets a structured denial and the whole thing is in the audit log.

It also scans MCP tool descriptions for prompt-injection patterns
(the "tool poisoning" attack), watches for tools whose definitions
change mid-session (rug-pulls), and blocks credentials from leaving in
call args. Plus call-rate caps so a looping agent gets stopped instead
of running all night.

npm i -g habena && habena init

Repo: https://github.com/vh2225/habena — would love feedback,
especially from anyone running always-on local agents.
```

Attach: 3-screenshot flow (Telegram approval buzz → dashboard decisions
stream with a threat badge → `habena watch` terminal). Local-first angle
front and center.

---

## Reddit — r/selfhosted

**Title:** `Habena: self-hostable safety layer for MCP-based AI agents`

Lead with "everything stays on your machine": SQLite audit, config in
`~/.habena/`, dashboard bound to localhost, threat detection is local
heuristics (explicitly NO cloud feed), works air-gapped except the
optional Telegram channel. MIT, no telemetry, no phone-home.

---

## X / Twitter thread

Eight tweets max:

1. "My AI agent can read my email. Today I shipped the thing that makes
   that less terrifying: Habena, an open-source safety proxy for MCP
   agents. MIT, no paid tier. npm i -g habena → github.com/vh2225/habena"
2. Why: agents get powerful faster than they get safe; every tool picks
   ONE of (safer, more autonomous). The middle layer gets you both.
3. Architecture diagram (the one in the README).
4. 30s clip: write blocked → phone buzz → tap Deny → audit log entry.
5. The threat firewall: tool-poisoning, credential-egress, rug-pull
   drift — checked at startup AND mid-session. All local heuristics.
6. The honest part: it can't see your token bill (it proxies tools, not
   the LLM), so it caps what it CAN measure — call rates and context
   stuffing. Honesty section in the README.
7. What's not done: registry trust scores, provider-side cost ingestion,
   multi-user. All MIT, contributors welcome.
8. Repo + ask: "tell me what I got wrong."

---

## Demo script (record once, use everywhere)

Target: 60–90 seconds, terminal left, dashboard right. Rehearse twice.

**Setup beforehand (off camera):** clean `~/.habena` (`mv ~/.habena
~/.habena.bak`), Telegram channel configured, dashboard running
(`pnpm -F habena-web dev`), an MCP client you can drive (OpenClaw or
the MCP inspector) pointed at Habena.

1. **Install + init (10s).**
   `npm i -g habena && habena init`
   — point at the output: cautious preset, call-rate caps on by default.
2. **Wire + start (10s).**
   `habena downstream add filesystem ~/workspace && habena start`
   — point at the startup lines: downstreams healthy, threat scan ran.
3. **The money shot (20s).** Agent asks to write a file OUTSIDE
   `~/workspace`. Call freezes. Phone buzzes (film the phone or screen-
   mirror). Tap **⛔ Deny**. Agent receives a structured denial.
4. **Receipts (10s).** Dashboard: Decisions stream shows the deny;
   Overview shows the counters tick. `habena logs --decision deny`
   shows the same from the terminal.
5. **Hard floor (10s).**
   `habena policy explain shell_execute --args '{"command":"rm -rf /"}'`
   → hard_mandatory deny, built_in tier. "Some things are never
   negotiable — no approval can override these."
6. **Close (5s).** "Policy, approvals, threat detection, audit — one
   proxy, all local, MIT. github.com/vh2225/habena"

Optional 15s extension if it lands well: edit a mock tool's description
mid-session, wait for the re-scan tick, show the rug-pull flag appear.

---

## General cross-post notes

- Post times: HN Tuesday 8–10am PT. Reddit any weekday mid-morning.
- HN: "Show HN" prefix + a demo asciinema/video link near the top — not
  just a GitHub URL.
- Keep the thesis (safer AND more autonomous) front-and-center. "Yet
  another MCP tool" won't hold attention.
- The honesty is the differentiator: the cost section says plainly what
  it can't see, the README says "heuristic, best-effort", the status
  section says single-operator tested. HN rewards this; don't sand it off.
- Respond to every comment in the first 4 hours.
- Track referrers: GitHub Insights → Traffic (14-day window), npm
  download stats at npmjs.com/package/habena.
