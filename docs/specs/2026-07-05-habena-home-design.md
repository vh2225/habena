# Habena Home — all-in-one guarded-agent setup for non-technical users

**Date:** 2026-07-05
**Status:** Approved design, pre-implementation
**Supersedes/extends:** builds on `docs/specs/2026-04-15-phase7-chat-channels.md` (inbound channels) and the shipped onboarding wizard (`docs/plans/2026-06-09-habena-onboarding-wizard-design.md`).

## Product statement

"Habena Home" is a signed Mac app, distributed on a .dmg (and copyable to a USB stick), that takes a non-technical person from double-click to chatting with their own guarded AI agent with zero terminal use. The app installs everything (Node runtime, Habena, OpenClaw or Hermes), walks them through permissions in plain language, lets them talk to the agent from the app or Telegram, and offers a few curated recurring tasks. The USB drive's extra trick: the app can back up the whole setup (config + keys, encrypted) to the drive and restore it on a new machine.

**Success criterion (release gate):** a fresh macOS machine, .dmg in hand, reaches the first successfully *approved* agent action in under 15 minutes with no terminal use ("grandma test").

## Scope decisions (locked)

- **Delivery model:** USB/.dmg is a *bootstrapper* — the app installs onto the machine; nothing executes from the drive. The drive additionally carries encrypted backups.
- **Mac-first.** No Windows/Linux in this phase.
- **One agent, done well.** Install and guard a single agent (OpenClaw or Hermes). Multi-agent swarm is a later phase.
- **Channels:** built-in web chat (first) + Telegram inbound (second). No iMessage, no voice.
- **Tasks:** on-demand chat + 3–5 curated schedule templates via launchd. No freeform scheduling.
- **Form factor:** native Tauri menu-bar app (`packages/app`), thin shell over the existing Node/TS stack; the UI inside the window is habena-web extended with a "guided mode."

## Decomposition

Five sub-projects, each getting its own spec → plan → implementation cycle, in this order:

1. **Agent chat bridge + inbound channel framework** (`packages/core`) — how a human message reaches the agent and the reply comes back. Implements the Phase 7 spec (scope binding, confirmation for irreversible actions, rate limits); web chat is the first channel, Telegram inbound the second. Goes first because it is the riskiest piece: it depends on OpenClaw/Hermes session APIs, which need investigation before the rest is committed.
2. **Guided mode** (`packages/web`) — consumer-grade skin on the existing dashboard: rebuilt first-run wizard, chat UI, plain-language permission cards; current dashboard behind an "Advanced" toggle.
3. **Tauri shell** (`packages/app`, new) — bootstrap (bundled Node runtime; installs habena + the agent), process supervision, menu-bar status, macOS notifications for approvals, Keychain for API keys, signing/notarization, .dmg packaging, auto-update.
4. **Curated schedules** — vetted task templates scheduled via launchd, managed from guided mode, every run guarded by Habena.
5. **USB backup/restore** — encrypted export/import of `~/.habena` + keys to the drive.

## Architecture

Thin native shell, one UI codebase:

```
                    ┌─ menu bar · notifications · Keychain · updater
Habena.app (Tauri) ─┤
                    └─ supervises child processes ──┐
                                                    ▼
   webview/browser ──► habena-web (guided + advanced UI)
   Telegram ─────────► habena core ◄──── chat channel manager
                          │  ▲
              (MCP proxy) │  └── chat bridge ──► agent (OpenClaw/Hermes session)
                          ▼
                    downstream MCP servers (filesystem, gmail, …)
```

- The Rust side stays deliberately dumb: only what a browser can't do (install, supervise, Keychain, notify, auto-update). All logic stays in Node/TS.
- Install target: `~/Library/Application Support/Habena/` (runtime, agent) plus the existing `~/.habena/` (config, audit). Nothing global; no sudo, ever.
- Message flow: channel → core chat manager (auth, scope, rate limit) → bridge → agent session. The agent's tool calls flow back through the existing Habena MCP proxy path — chat gets zero policy bypass.
- API keys move to the macOS Keychain; core reads them through a small keychain helper with env-var fallback for non-app (npm) users.

## Guided-mode UX

The wizard is the product. Seven screens, one decision each, no jargon:

1. **Welcome** — "Set up your personal AI assistant, safely. About 10 minutes." One button.
2. **Pick your assistant** — OpenClaw or Hermes as cards with a one-line personality. Download, install, and wiring happen behind a single progress bar with human-readable steps.
3. **Your key** — paste an Anthropic API key (illustrated guide to getting one), stored in Keychain, validated live with a test call before proceeding. Highest-drop-off step, so it gets the most care: clear error states and an "email me the guide" escape hatch.
4. **What can it touch?** — policy as plain-language permission cards, not YAML. Three or four capabilities (Files in a folder you pick / Email / Calendar / Web), each with a three-position choice: **Yes · Ask me first · Never**, defaults mapping to the `cautious` preset. One sentence under each explains the consequence. Spending is one slider: daily budget, default $5.
5. **How do you want to talk to it?** — Web chat (zero setup) and/or Telegram (guided BotFather walkthrough with screenshots, deep-link buttons, and a send-yourself-a-test-message verification step).
6. **First conversation** — a scripted exchange that deliberately triggers an approval ("Ask your assistant to save a note in your folder") so the user experiences ask-me-first: notification → tap Approve → watch it work.
7. **Done** — menu-bar tour: green = guarded and running, badge = approvals waiting, and the big red "Pause everything" (existing lockdown, renamed for humans).

Post-setup **Home** screen: chat front and center, a status strip (guarded ✓ · spend today · approvals pending), and the schedule gallery. "Advanced" reveals the full existing dashboard unchanged.

## Channels

**Web chat** (first): chat pane in habena-web talking to core's chat manager over the existing local API plus a streaming endpoint. The bridge maintains one agent session; replies stream token-by-token. Approvals surface inline in the chat ("⏸ Your assistant wants to *delete draft.txt* — Allow / Deny") as well as via menu-bar notification.

**Telegram inbound** (second): implements the Phase 7 spec — owner-only binding to the user's chat ID during the wizard, per-channel scope (Telegram defaults to a *tighter* floor than web chat: a stolen phone is likelier than a stolen Mac), two-channel confirmation for irreversible actions, rate-limit circuit breakers. Reuses the shipped outbound-approvals bot and auth.

**Invariant: channels carry conversation, never policy.** Nothing typed in chat can widen a permission; permission changes happen only in the app's permissions screen. Prompt injection via chat therefore cannot become privilege escalation.

## Curated schedules

A gallery of 3–5 vetted templates, not freeform cron: **Morning brief** (8am calendar + inbox summary to your channel), **Weekly inbox digest**, **Folder watch** ("tell me when new files land in X"). Each template card states, before enabling, exactly which permissions it uses and its per-run budget cap. Enabling one writes a per-user launchd agent that invokes `habena run-template <id>` in core — scheduled runs go through the identical policy/budget/audit path as interactive chat, attributed to the template's own agent identity so spend is separately visible and cappable. Templates ship with the app and are versioned with it; no user-editable prompt text in v1.

## Failure handling & security posture

- **Installer:** every step is check → do → verify, resumable and idempotent — rerunning the wizard repairs a broken install (`habena doctor` grown into a repair engine). Agent config changes keep the existing timestamped-backup + rollback pattern. User-scoped everything; no sudo.
- **Supervisor:** restarts crashed processes with backoff; menu bar goes amber with a plain-language message and a "Fix it" button (runs doctor/repair). Never a stack trace.
- **Keys:** Keychain only; never written to YAML or logs; existing secret-redaction applies to chat transcripts too.
- **Fail closed everywhere**, matching current core behavior: bridge down → chat says "assistant is offline"; unevaluable policy → deny; Telegram identity mismatch → silent drop + audit entry.
- **App integrity:** signed + notarized; Tauri auto-updater with signature pinning. USB backups are age-encrypted with a user-chosen passphrase.

## Testing

TDD (Red/Green) throughout. Core pieces (chat manager, bridge, template runner, keychain helper with env fallback) are vitest units plus the existing E2E harness against the real filesystem MCP server. The installer engine gets a fixture "fake agent" for fast tests plus a real OpenClaw install E2E on a macOS CI runner. Guided-mode wizard gets Playwright flows, including the deliberate-approval first-run script. The Tauri shell keeps so little logic that smoke tests (launch, supervise a dummy process, notify) suffice. Release gate: the scripted grandma test on a fresh macOS VM — first approved action in under 15 minutes, no terminal.

## Open investigations (before sub-project 1 is spec'd)

- **OpenClaw session API:** confirm how a headless conversation session is created/resumed and how streaming replies are exposed (the local gateway pattern on :18789 is the likely shape).
- **Hermes install/config shape:** flagged as unknown since the 2026-06-08 design doc; must be resolved before the wizard's assistant-picker offers it. If it can't be wired cleanly, v1 ships OpenClaw-only with Hermes greyed out ("coming soon").
- **Node runtime bundling:** bundle in the .app vs first-run download — decide on .dmg size vs first-run network dependency in the Tauri shell spec.
