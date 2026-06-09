# Habena UI/UX Design — Onboarding Wizard + Live Dashboard

**Date:** 2026-06-09
**Status:** Research-backed design recommendation for Workstream C (web UI)
**Audience:** technical-but-non-expert prosumers running always-on assistants, Mac-first.

Synthesis of deep UI/UX research (19 claims verified 3-0, 6 refuted) into a buildable design +
component stack for Habena's two web surfaces — the **onboarding wizard** and the **live
dashboard** (localhost, Next.js 16 + React 19).

**Evidence tags** on each recommendation: **[verified]** = backed by ≥1 primary source,
adversarially confirmed; **[judgment]** = my engineering call, *not* found in the research (treat
as a default to revisit); **[taste]** = a defensible aesthetic choice the research explicitly did
**not** support as a best practice (use it because we like it, don't claim it as proven).

---

## 0. The one-line UX thesis
> Make the abstract promise ("your agent can't drain your wallet or go rogue") **visible and
> tactile**: a spend gauge you watch, an approval you tap, a decision stream you read. Premium
> feel = restraint, speed, and trustworthy clarity — not decoration.

---

## 1. Component stack

- **[verified]** **Tailwind + shadcn/ui (Radix primitives).** Radix gives correct focus/ARIA;
  copy-in components, no runtime lock-in. **Caveat (verified):** shadcn's *default styling can
  undercut* Radix a11y — the default `muted-foreground` is **4.34:1**, below WCAG AA's 4.5:1
  (shadcn issue #8088). **Action:** override muted text to ≥4.5:1 and verify the focus ring hits
  3:1 non-text contrast. (Note: a widely-cited "34/48 components pass" audit was *refuted* —
  don't rely on its specific counts; do the contrast fix, which is independently confirmed.)
- **[verified]** Add a **Cmd+K command palette** and a proper **data-table** to the stack.
- **[taste]** Optional **Linear-style tokens** (these specific tokens are verified as what Linear
  uses, but adopting them is a taste choice): **Inter / Inter Display** for headings, **LCH**
  color space, and a small set of (~three) theme variables.
- **[judgment]** **Charts/gauges: Tremor** (built on Tailwind, dashboard-native) with **Recharts
  v3** underneath for custom charts. ⚠️ *The research found NO verifiable claims comparing
  chart libs (Tremor/Recharts/visx/Nivo) or spend-viz patterns* — this is my call, not evidence.
  Revisit before committing; visx/Nivo are fine alternatives.
- **[judgment]** TanStack Table (headless) for the stream; `sonner` toasts; `lucide` icons.

---

## 2. Premium-feel principles
- **[taste]** **Restraint & density** — one accent + a disciplined neutral ramp; **monospace for
  technical values** (tools, costs, latency, IDs). (Note: specific Linear claims about a *flat
  grid / sharp edges / 1px separators* were **refuted 0-3** — don't treat those as rules.)
- **[taste]** **Dark-first, system-aware** theme. (The "dark-first + keyboard-first + vim-nav is
  the recommended system" claim was **refuted 1-2** — so dark-first is our aesthetic choice, not
  a proven best practice.)
- **[taste]** **Purposeful, fast motion**; skeletons over spinners. (The specific "200ms
  ease-out / optimistic-updates" prescription was **refuted 1-2** — keep motion subtle by
  preference, don't cite a magic duration.)
- **[judgment]** **Empty states that teach** ("No decisions yet — start your agent and tool calls
  stream here") and a command palette for speed.

---

## 3. Onboarding wizard
- **[verified]** Use a **single-pass wizard with a visible, highlighted step list** —
  wizards are best for **novice / infrequent setup** (NN/g "Wizards"), which first-run is.
- **[verified]** **Progressive disclosure**: show a few options with **safe defaults**, hide
  advanced behind "more" — it measurably improves learnability, efficiency, and error rate (NN/g).
- **[verified/judgment]** Target **~4–5 steps** (research says "3–5"; exact count is an open
  question):
  1. **Pick what you're guarding** — OpenClaw · Hermes · Claude Desktop · "guard tools manually."
  2. **Wire a downstream** — filesystem one-click default; others collapsed.
  3. **Policy preset** — `cautious` pre-selected, one plain line each.
  4. **Daily budget** — pre-filled sane default (e.g. $10/day).
  5. **(Optional) phone approvals** — connect Telegram, clearly skippable.
- **[judgment]** End on **"send a test call" → watch it land on the dashboard** (the aha / first
  value). Safe defaults so **Next→Next→Done** yields a working guarded agent; inline validation;
  never block on optional steps; "you can change this later" reassurance.

---

## 4. Live dashboard
**[judgment]** Frame: left nav (Overview · Decisions · Approvals · Agents · Spend · Policy) + a
persistent **top status bar** (proxy health, today's spend vs budget, pending-approvals count).

### 4a. Decision stream — model on observability log UIs **[verified]**
- **Live-tail that *samples uniformly under load*** rather than dropping or freezing (Datadog Live
  Tail). For a single personal assistant, volume is low, so this mostly matters during bursts —
  but build the sampling/pause affordance in from the start.
- **Two density modes — condensed vs. expanded** (New Relic Logs UI).
- **Drill-down two ways: a side panel *and* inline expansion, with auto-formatted JSON** for args.
- **A "patterns" view** (group similar events; click/drag to select a span) to tame repetition.
- **[judgment]** Columns: time · agent · tool · server · decision badge · tier · rule · latency;
  filters (agent/decision/server/time); row → drawer shows the `policy explain` trace (the *why*).

### 4b. Approvals queue (build first) **[verified] + [judgment]**
- **[verified]** Present the decision with a **plain-language rationale / benefit copy** — giving
  a *reason* makes people meaningfully more likely to decide correctly (NN/g permission requests;
  effect size from Tan et al. CHI 2014 — **caveat: a 2014 smartphone study, directional not
  precise**). Trigger the ask **in context**, not preemptively.
- **[verified]** **Status badges use ≥2 of {color, shape, symbol} at ≥3:1 contrast** — never
  color alone (Carbon/WCAG).
- **[judgment]** Card: **"Agent X wants to call `tool` — [Allow once] [Allow session] [Deny]"**
  with the **real tool + args** shown, reason, countdown to timeout. The **safe choice is the
  low-friction default**; the destructive action is *not* the easy/primary button (prevents
  mis-taps). This is the browser twin of the Telegram phone-tap flow.
- **[judgment]** **Lies-in-the-loop guard:** show the agent's *actual* requested tool + args
  faithfully (truncated, not misleading) — a HITL approval is only as safe as what the human sees.

### 4c. Per-agent drilldown **[judgment]**
Spend, decision history, top tools, budget status, fingerprint — one screen per agent/instance.

### 4d. Spend gauges **[judgment]** ⚠️ research gap
Top-bar + Spend page: today vs daily budget, burn-rate, **threshold colors** (green/amber/red),
a calm warning *before* the cap. *No spend-viz pattern was verifiable in the research* — this
follows common billing-dashboard convention (AWS/Stripe/Vercel), but treat as unvalidated.

### 4e. Threat alerts (low-noise) **[verified]**
- **Each alert enriched with severity + scope/affected + recommended action/remediation** — this
  is the verified antidote to **alert fatigue** (Wiz). Only high-signal alerts; group; allow
  ack/snooze. A wall of red trains users to ignore it. (Feeds from Workstream B.)

---

## 5. Trust & safety lens **[verified core]**
- **Status semantics:** green = allow · red = deny/block · amber = needs-approval/warning ·
  neutral = info — always **color + a second channel (shape/icon)** at ≥3:1 (a11y).
- **Authoritative but calm [taste]:** reserve red strictly for genuine deny/threat; plain-language
  "why this was flagged," no jargon walls. (A security UI that feels alarmist loses trust.)
- **Explain requests** in terms of *what + why + consequence* (NN/g, verified rationale effect).

---

## 6. Do-these-first (5 moves, in order)
1. **[verified]** Stand up Tailwind + shadcn/ui; **fix the muted-text contrast to ≥4.5:1** and
   focus-ring to ≥3:1 on day one.
2. **[verified+judgment]** Build the **approvals queue** first — rationale copy, ≥2-channel
   status badges, safe-default button, real tool+args. Highest-value trust moment.
3. **[verified]** **Decision stream** as live-tail (sample-under-load + pause) with
   condensed/expanded density and a side-panel/inline JSON drill-down to the policy trace.
4. **[judgment]** **Spend gauge** with threshold colors in the top bar (validate the pattern).
5. **[verified]** **Wizard**: visible highlighted step list + progressive disclosure + safe
   defaults, ending on a test-call aha.

---

## 7. Open questions (decide during build)
- Exact wizard step count (research says 3–5; I lean 4–5).
- Approval **default action + undo** behavior (research didn't settle this — pick deny-default,
  add an undo window?).
- Live-tail defaults for **single-assistant** (low) volume — sampling may rarely trigger; tune
  pause/auto-scroll behavior for low rates.
- Chart/gauge library + spend-viz pattern (research gap — Tremor is a default, not a verdict).

## 8. Verified sources
NN/g (Wizards; Progressive Disclosure; Permission Requests) · Datadog Live Tail · New Relic Logs
UI · IBM Carbon status-indicator pattern (WCAG) · Wiz (alert fatigue) · shadcn/ui issue #8088
(muted-foreground contrast) · Linear redesign (Inter Display / LCH / theme tokens) · Krystal
Higgins setup wizards · Mastra HITL approval.
**Refuted (do not cite as fact):** Linear 200ms-motion/optimistic-updates; dark-first+vim-nav as
"the system"; flat-grid/sharp-edges; the 34/48 shadcn audit counts; Wiz's 26k→12 funnel stat.
**Gaps:** no verifiable chart-lib or spend-viz claims.
