# Habena UI/UX Design — Onboarding Wizard + Live Dashboard

**Date:** 2026-06-09
**Status:** Research-backed design recommendation for Workstream C (web UI)
**Audience:** technical-but-non-expert prosumers running always-on assistants, Mac-first.

This synthesizes deep UI/UX research (sources cited inline) into a concrete, buildable
design + component stack for Habena's two web surfaces: the **onboarding wizard** and the
**live dashboard** (localhost, Next.js 16 + React 19).

---

## 0. The one-line UX thesis

> Make the abstract promise ("your agent can't drain your wallet or go rogue") **visible and
> tactile**: a spend gauge you watch, an approval you tap, a decision stream you can read.
> Premium feel comes from restraint, speed, and trustworthy clarity — not decoration.

---

## 1. Component stack (do this first)

A "low-effort, high-polish" stack that the research consistently points to:

- **Tailwind CSS + shadcn/ui** (Radix primitives) — copy-in components, full control, no
  runtime lock-in, strong accessibility baseline (shadcn/ui Accessibility Audit 2026). This is
  the spine.
- **Tremor** for dashboard primitives (KPI cards, gauges, progress circles, bar lists, spark
  charts) — it's built *on* Tailwind and pairs with shadcn; fastest path to a polished
  dashboard. Use **Recharts v3** underneath for any custom chart Tremor doesn't cover. Skip
  Nivo unless we need exotic viz (heavier) — per the Recharts-vs-Tremor-vs-Nivo comparison,
  Tremor=dashboards, Recharts=flexible custom charts.
- **TanStack Table** (headless) + shadcn table for the decision stream (virtualized).
- **cmdk** (command palette), **sonner** (toasts), **lucide** (icons), **Framer Motion** used
  sparingly for purposeful 150–200ms micro-interactions.
- **Dark-first** theme, system-aware, via CSS-variable design tokens (shadcn theming).

---

## 2. Premium-feel principles (Linear / Vercel / Stripe)

From "How Stripe, Linear, and Vercel Ship Premium UI," Linear design patterns, and the Vercel
Blueprint-grid aesthetic:

- **Restraint & density.** One accent color + a disciplined neutral ramp; generous whitespace
  on a tight underlying grid; **monospace for technical values** (tool names, costs, latency,
  IDs).
- **Speed & keyboard-first.** Command palette (`⌘K`), keyboard shortcuts, instant transitions.
  Perceived performance *is* polish.
- **Purposeful motion only.** Fast, subtle, never bouncy. Skeletons over spinners.
- **Empty states that teach**, not blank panels ("No decisions yet — start your agent and
  tool calls will stream here").
- **Consistent status semantics** everywhere (see §5 color).

---

## 3. Onboarding wizard

**Goal = time-to-first-value:** the "aha" is *seeing a guarded tool call happen*. Optimize the
whole flow to reach that fast (Time-to-Value SaaS frameworks; NN/g "Wizards").

**When a wizard is right (NN/g):** infrequent, complex, sequential setup — onboarding qualifies.
Don't wizard-ify things that should be a single form.

**Steps** (linear, visible step indicator, **safe defaults pre-filled so Next→Next→Done
works**, advanced options behind progressive disclosure — NN/g "Progressive Disclosure"):

1. **Welcome / pick what you're guarding** — OpenClaw · Hermes · Claude Desktop · "just guard
   tools manually." Sets the wiring path.
2. **Wire a downstream** — filesystem one-click default (pick a folder); Gmail/others optional
   and collapsed.
3. **Choose a policy preset** — `cautious` pre-selected; one plain-language line each
   (observe / cautious / deny-all).
4. **Set a daily budget** — pre-filled sane default (e.g. $10/day); a single field.
5. **(Optional) phone approvals** — connect Telegram; clearly skippable ("you can add this
   later"). Links to `docs/approval-channels.md`.
6. **Done → "Send a test call"** — triggers a sample tool call and **highlights it landing on
   the dashboard**. That's the aha moment.

**Rules:** inline validation + friendly error recovery; never block on optional steps; a
persistent "you can change all of this later" reassurance; remember progress if they bounce.

---

## 4. Live dashboard

**Frame:** left nav (Overview · Decisions · Approvals · Agents · Spend · Policy) + a persistent
**top status bar** (proxy health dot, today's spend vs budget, pending-approvals count).

### 4a. Decision stream (the heart)
A **live-tail, virtualized table**: time · agent · tool · server · **decision badge** · tier ·
rule · latency. From log-viewer UX (Logdy/observability patterns):
- **Live-tail toggle** — pause to inspect, resume to follow (don't yank rows out from under a
  reading user).
- **Filters**: agent, decision type, time, server. **Group/collapse** repetitive identical
  rows to fight volume.
- **Row → drawer**: full args + the **policy trace** (reuse `habena policy explain` output) so
  the user sees *why* it was allowed/denied.

### 4b. Approvals queue (highest-value panel — build first)
The browser twin of the phone-tap flow: a card per pending approval —
**"Agent X wants to call `tool` — [Allow once] [Allow session] [Deny]"** with the **real tool +
args** shown, the reason, a **countdown to timeout**, and risk signaling.
- **Safety-critical:** the destructive/allow action must NOT be the easy/primary-styled button;
  make the safe choice the low-friction default (NN/g permission requests; web.dev Permission
  UX). Prevents mis-taps.
- **"Lies-in-the-loop" caveat (Checkmarx):** a HITL approval is only as safe as what's shown —
  display the agent's *actual* requested tool + args faithfully (truncated but not misleading),
  not just a narrative a poisoned tool could author.

### 4c. Per-agent drilldown
Spend, decision history, top tools, budget status, fingerprint — one screen per agent/instance.

### 4d. Spend gauges (the "won't drain your wallet" promise, made visible)
Top-bar + Spend page: today vs daily budget (Tremor ProgressCircle/BarList), burn-rate,
**threshold colors** green <50% · amber 50–80% · red >80% (AWS Budgets / Stripe usage). Surface
a calm warning as the cap approaches — before, not after.

### 4e. Threat alerts (low-noise)
A dedicated panel for rug-pull / tool-poisoning / credential-egress flags (Workstream B feeds
this). **Avoid alarm fatigue (Wiz):** only high-signal alerts, grouped, with ack/snooze. A wall
of red trains users to ignore it.

---

## 5. Trust & safety UX (the security-tool lens)

"Cybersecurity UI fails when users don't trust it" — so look **authoritative but calm**:
- Muted palette; **reserve red strictly** for genuine deny/threat. Plain-language "why this was
  flagged," never jargon-walls.
- **Color semantics (consistent, + icons not color-alone for a11y):** green = allow ·
  red = deny/block · amber = needs-approval/warning · neutral = info.
- Explain requested permissions in terms of *what* + *why* + *consequence* (NN/g, web.dev).

---

## 6. Do-these-first (5 moves, in order)

1. **Adopt the stack:** Tailwind + shadcn/ui + Tremor, dark-first CSS-variable tokens.
2. **Approvals queue UI** — highest value, mirrors the phone-tap demo, the core trust moment.
3. **Decision stream** — live-tail virtualized table + pause + row-drawer policy trace.
4. **Spend gauge in the top bar** — threshold colors; the wallet promise made visible.
5. **Onboarding wizard** with safe defaults → ends on a test-call "aha" on the dashboard.

---

## 7. Sources (verified in research)
NN/g (Wizards; Progressive Disclosure; Mobile Permission Requests) · Krystal Higgins (setup
wizards) · "How Stripe, Linear, and Vercel Ship Premium UI" (Mantlr) · Linear design patterns ·
Vercel Blueprint-grid aesthetic (Setproduct) · SaaS Time-to-Value frameworks (Digital Applied) ·
Logdy / log-viewer UX · HITL agent-approval patterns (Mastra) · "Lies-in-the-Loop" HITL caveat
(Checkmarx) · web.dev Permission UX · "Why Cybersecurity UI Design Fails…" (Skins Factory) ·
Alert fatigue (Wiz) · Recharts v3 vs Tremor vs Nivo (PkgPulse) · shadcn/ui Accessibility Audit
2026 · AWS Budgets / Stripe usage (spend viz).
