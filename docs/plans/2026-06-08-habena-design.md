# Habena — Design & Go-to-Market Plan

**Date:** 2026-06-08
**Status:** Approved design (brainstorming complete) — ready for implementation planning
**Author:** Vinh Hoang (with Claude)
**Supersedes branding:** "AgentGuard" → **Habena**

---

## 1. Summary

Habena (formerly AgentGuard) is an open-source (MIT) MCP middleware proxy that is the
**safety layer for an always-on AI assistant**. It sits between an AI agent (OpenClaw,
Hermes, Claude-based assistants) and the real MCP servers/tools, enforcing policy, spend
caps, and one-tap human approval on every call, auditing every decision.

This document captures the result of a brainstorming session covering: market research,
positioning, the rename, scope to ~1.0, and the go-to-market sequence. **The chosen launch
strategy is GitHub-first**: make the repo genuinely good and runnable, publish it as
Habena, and read the reaction before investing in domain/landing-page/marketing.

---

## 2. The name

**Habena** — Latin for *rein / bridle strap*. Pronounced *ha-BAY-na*.
Tagline: **"Keep your AI agent on a short rein."**

### Why rename away from "AgentGuard"
"AgentGuard" is the single worst-contested name in this category. Research found **7+
products** using the exact name in the exact space, including a near-identical OSS clone:

- 🔴 **GoPlus AgentGuard** (`github.com/GoPlusSecurity/agentguard`, agentguard.gopluslabs.io)
  — open-source, local-first runtime security for AI agents: policy enforcement before
  risky tool calls, approvals, audit trails, MCP/skill supply-chain scanning. Word-for-word
  our positioning, same name, already on GitHub. **Disqualifying.**
- 🔴 **agentguard-ai/tealtiger** — OSS "security and cost tracking for AI applications."
- AppOmni AgentGuard, CyberArk Agent Guard, AgentGuard.tech, AgentGuardProtection.com,
  MerchantGuard AgentGuard.

Publishing as AgentGuard would make us invisible in search and look like the GoPlus clone.

### Why Habena
- Carries **both wedges** in one word: *you hold the reins* (human approval) and *rein it
  in* (cost / runaway restraint).
- npm `habena` is **free** (the name that matters most for an OSS tool).
- Distinct, short, pronounceable, uncontested in the AI-safety space.

### Known caveats (accepted)
- Minor phonetic overlap with **Habana Labs** (Intel AI chips) — different spelling,
  different category; low risk.
- Prime `habena.*` domains are tight (`habena.com` is an IT consultancy). Mitigation: OSS
  launches on the GitHub repo + npm; a domain is optional and can be a `.dev`/`.sh` or a
  qualifier, finalized later at a registrar.

### Studio attribution
Ship as **"Habena — an open-source project by 3app.studio."** The studio byline adds maker
credibility without subordinating the product. Do **not** host the product at a
`3app.studio/habena` subdirectory (reads as a side project; bad word-of-mouth; won't rank).

---

## 3. Strategic context (research findings)

Deep research (competitive landscape, MCP threats, OSS virality, the always-on-agent trend,
Mac sandboxing). Key verified findings:

### The competitive gap is real
Existing MCP-safety tools are built for **developers and security teams**, not for a normal
person running an always-on assistant:
- **Lasso `mcp-gateway`** (MIT, pip) — same proxy architecture, but plugin-based *detection*
  (secret masking, PII, prompt-injection). Dev tool.
- **Invariant Guardrails** (Apache-2.0) — rule-based flow analysis, prompt-injection +
  tool-poisoning detectors. Research-grade, Python, for AI app builders.
- **mcp-scan** — static manifest scanner; one-shot, not a live guard.

**None do human-in-the-loop approval + spend caps + turnkey onboarding for non-experts.**
That gap is the product.

### The fear stories that drive demand (landing-page / README material)
- **Tool poisoning** — Invariant Labs exfiltrated a Cursor user's `~/.ssh/id_rsa` via a
  poisoned tool description (instructions visible to the model, invisible to the user).
- **Rug-pull** — a malicious MCP server changes a tool's description *after* approval; the
  official Postmark MCP server shipped a backdoor BCC'ing every email to the maintainer.
- **Cost runaway** — $47k surprise bills; always-on agents burning $1–5k/day.

### Sandboxing — integrate, don't build
Crowded, fast-moving: Docker Sandboxes (Mac/Win microVMs), SandVault (user-account
isolation), Seatbelt/`sandbox-exec`, OrbStack. Smarter to wire/recommend a mature sandbox
than to build our own.

### OSS virality playbook
One-line install (`npx`/brew), a killer 60–90s demo, honest README, Show HN launch day.
Vercel's "free forever, no open-core" model matches our MIT stance.

---

## 4. Positioning & moat

**One-liner:**
> Habena is the open-source safety layer for your always-on AI assistant. It sits between
> your assistant and its tools so a runaway loop can't drain your wallet, a poisoned tool
> can't steal your secrets, and nothing dangerous happens without your one-tap approval.
> Install an assistant and guard it end-to-end in one command. Mac-first.

**The wedge (both, fused):** cost/behavior safety **and** threat firewall.

**The moat:** competitors are dev/security-team libraries. Habena is the safety layer a
**non-expert can install and live with**. Phone-tap approvals + a spend cap + a real
dashboard is the differentiator — not "better detection."

**Proof point:** the author's own `agentlab-scripts` runs three always-on OpenClaw bots
(Jarvis/Conch/Scribe) with AgentGuard already gating destructive WordPress tools via a
Telegram approval bridge. This is the dogfood + case study — to be generalized, never
shipped with the author's fingerprints (no Jarvis/Conch/Scribe, WordPress-editor, Shield05
bot, hardcoded `/home/vinh_hoang` paths).

---

## 5. Launch strategy: GitHub-first

Publish the repo (as Habena) as the cheapest possible market test. The GitHub repo + npm
package + README/demo **are** the homepage. No domain or landing page required to start.

### The fairness floor (what makes the test valid)
A visitor who clones it must get a working tool, or the signal is "broken," not "bad idea":
1. **Forwarding works** — approved calls actually execute against downstream MCP servers
   (today stubbed `{forwarded: true}`). **#1 blocker.**
2. **Tests green** — fix the 11 failing policy-explain tests; CI passing.
3. **`npx`-runnable cold** — `npx habena` works without a clone.
4. **README with a real demo** — the dangerous-call → phone-buzz → tap-Deny → blocked moment,
   plus the three fear stories.
5. **Renamed to Habena** — repo, npm, CLI binary, config namespace.

### Success signals (decide whether to invest further)
Soft targets to read reception, not vanity goals:
- GitHub stars trajectory in the first 1–2 weeks after a Show HN / r/LocalLLaMA /
  r/selfhosted post.
- Issues/discussions from people who actually ran it.
- Anyone wiring it to a non-OpenClaw agent unprompted.

If signal is positive → invest in workstreams C–F below. If flat → cheap lesson, iterate
on positioning or pivot.

---

## 6. Product scope — six workstreams

Ordered by the GitHub-first critical path. **A is the floor for any public push.**

### A. Core correctness *(P0 — blocks the GitHub-first launch)*
1. **Verify + clean the forwarding path** — *correction after code review:* end-to-end
   forwarding **already works** on the live stdio path (`createMcpServer` →
   `DownstreamManager.forward()` → `DownstreamClient.callTool()` via the real MCP SDK). The
   only "stub" is a **vestigial, unused `Forwarder` class** that throws. Task is: add an
   integration test proving end-to-end forward, delete/retire the dead `Forwarder`, and fix
   the misleading "Phase 1/Phase 2" comments. Not a build-from-scratch item.
2. **Get tests green** — fix the 4 failing `policy-explain` tests: `policy explain --json`
   exits status 1 on a `deny` decision, but it's a trace command — a deny is a valid result,
   so it must exit 0. CI gate.
3. **npm + `npx` ready** — publish `habena`; `npx habena` works cold.
4. **Rename** — AgentGuard → Habena across repo, CLI, config dir (`~/.habena/`), docs. Provide
   a migration shim for existing `~/.agentguard/` users (the author).

### B. Threat firewall *(the "antivirus" half of the wedge)*
5. **Tool-poisoning + rug-pull detection** — hash each downstream tool's
   description/manifest at first sight; alert + require re-approval on silent change.
   Scan descriptions for injected-instruction patterns.
6. **Credential-egress guards** — built-in rule pack flagging/blocking tool calls whose args
   contain secrets, SSH keys, `.env`, token-shaped strings.
7. **Threat feed MVP** — blocklist of known-bad MCP servers, synced like AV signatures.

### C. Onboarding + dashboard *(the consumer experience)*
8. **Setup wizard (web)** — guided: pick assistant (**OpenClaw / Hermes** first) → install &
   wire it → choose downstreams → set budget + policy preset → done. Generalized.
9. **Dashboard 2.0** — approvals UI, per-agent drilldown, live spend gauges, threat alerts
   (upgrade from today's read-only decision stream).

### D. One-tap approvals anywhere *(the viral demo moment)*
10. **Generic chat-approval channel** — phone-tap Allow/Deny via Telegram (then
    Slack/ntfy/Discord), generalized from the agentlab bridge into a configurable core
    feature. This *is* the 60-second demo.

### E. Mac-first guarded sandbox *(integrate + recommend)*
11. **One-command guarded-sandbox recipe** — script + runbook standing up Habena + an
    assistant inside OrbStack/Docker on a Mac mini, with a `launchd` service for always-on.
    We wire mature sandboxes; we don't build a VM.

### F. Launch assets *(activate after positive GitHub-first signal)*
12. One-line install (`npx` / Homebrew tap), **killer demo video**, optional landing page,
    launch kit for Show HN / r/LocalLLaMA / r/selfhosted / MCP + OpenClaw communities.

---

## 7. Critical path

```
A (forwarding + tests + npm + rename)   ← GitHub-first floor; non-negotiable first
   └─► D (chat approvals — the demo)
          └─► README + demo video  ──►  PUBLISH AS HABENA / Show HN  ◄── decision gate
                                             │
                  (positive signal?) ────────┤
                                             ▼
        C (wizard + dashboard) ∥ B (threat firewall) ∥ E (sandbox recipe) ──► F (full launch)
```

**Recommendation:** treat **A + D + README/demo** as the tight, lovable core that goes
public. B, C, E are fast-follow gated on reception. This avoids building a sprawling 1.0
before knowing anyone wants it — the explicit point of going GitHub-first.

---

## 8. Risks & open questions

- **Forwarding scope** — does the real forwarding path need streaming/HTTP-transport
  downstreams for v1, or is stdio enough for the OpenClaw/Hermes case? (Lean: stdio first.)
- **Rename blast radius** — config-dir migration for the author's live agentlab without
  breaking the running bots. Provide `~/.agentguard/` → `~/.habena/` shim.
- **Hermes wizard support** — confirm Hermes' install/config shape to wire the wizard
  (OpenClaw is known; Hermes needs investigation).
- **Threat-feed source** — where do blocklist signatures come from at MVP (hand-curated vs.
  pulling an existing feed like mcp-scan's)?
- **Demo realism** — the demo must use a generic, reproducible scenario (not the author's
  WordPress setup) so strangers can replicate it.

---

## 9. Decisions captured this session

| Decision | Choice |
| --- | --- |
| Name | **Habena** (Latin "rein"); npm free; studio byline 3app.studio |
| Wedge | **Both** — cost/behavior safety **and** threat firewall, fused |
| Sandbox | **Integrate + recommend** (pure proxy + Mac guarded-sandbox recipe) |
| UI | **Onboarding wizard + live dashboard** |
| Wizard agents | **OpenClaw + Hermes** first |
| Launch | **GitHub-first** validation; tight A+D core public, B/C/E fast-follow |
| Domain | Optional; GitHub + npm is the homepage; not a blocker |
```
