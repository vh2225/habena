# Habena Phase D — Telegram One-Tap Approvals Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans / subagent-driven-development to implement task-by-task.

**Goal:** Let a non-expert get phone-tap Allow/Deny approvals by adding one `telegram:` block to `~/.habena/config.yaml` — no separate process, no systemd.

**Architecture:** In-core approval **channel**. `ApprovalQueue` is already an `EventEmitter` that emits `approval_request` / `approval_resolved`. A `TelegramApprovalChannel` runs *inside the proxy process*: on `start`, it subscribes to the queue, sends a Telegram message with inline Allow/Deny buttons per request, long-polls `getUpdates` for the owner's button tap, and calls `approval.respond(id, {choice})` directly. CLI `watch` + webhook `forward` keep working unchanged (they listen to the same events over IPC). This generalizes the proven agentlab `approval-bridge.mjs` pattern into core, stripped of all user-specific config.

**Tech Stack:** TypeScript, Node 20+ (global `fetch`), Vitest. No new deps (use built-in `fetch`, `node:crypto` for the callback token).

**Security model (non-negotiable, TDD these):**
- Only the configured `owner_id` chat may approve; every `callback_query` from any other `from.id` is rejected with an "unauthorized" answer and ignored.
- `callback_data` choice is validated against a strict allowlist (`allow_once` | `deny`; `allow_session` deliberately omitted to shrink attack surface). Unknown/malformed callback data is dropped.
- Tool args are truncated in the message (never dump unbounded/secret-bearing args to a chat).
- Bot token may be given inline OR via an env-var name (so the token need not sit in the yaml).

**Reference (read, do not couple to):** `/home/vhoang/github/agentlab-scripts/agentguard/approval-bridge.mjs` — the working pattern. Pull the pure helpers (`parseCb`, `promptText`, `fmtArgs`, token map) into core; drop @Shield05/owner/socket specifics.

---

## Task D1: ApprovalChannel interface + lifecycle wiring (no Telegram yet)

**Files:**
- Create: `packages/core/src/approval/channel.ts`
- Modify: `packages/core/src/policy/types.ts` (extend `ApprovalConfig`)
- Modify: `packages/core/src/cli/commands/start.ts` (start/stop channels)
- Test: `packages/core/tests/approval/channel.test.ts`

**Step 1 — Test first.** Write a test with a fake channel implementing the interface; assert `start()` is called once during proxy boot wiring and `stop()` on shutdown, and that a channel receives an `approval_request` when the queue emits one.

**Step 2 — Define the interface.**
```ts
export interface ApprovalChannel {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```
Channels are constructed with a reference to the `ApprovalQueue` (to subscribe to events and call `respond`). Keep it minimal — YAGNI, no plugin registry.

**Step 3 — Extend config types.** In `policy/types.ts` `ApprovalConfig`:
```ts
channels?: {
  telegram?: { token?: string; token_env?: string; owner_id: string | number };
};
```

**Step 4 — Wire start.ts.** Build a `channels: ApprovalChannel[]`; if `config.approval?.channels?.telegram` present, push a `TelegramApprovalChannel` (added in D3 — for D1 use the fake/no-op so wiring lands first). `await ch.start()` for each after the queue/IPC are up; `await ch.stop()` in the shutdown path. Failure of one channel must NOT crash the proxy (log + continue), mirroring the IPC-start try/catch.

**Step 5 — Run tests green. Commit:** `feat(approval): ApprovalChannel interface + lifecycle wiring`

---

## Task D2: Telegram API client + pure helpers (no queue yet)

**Files:**
- Create: `packages/core/src/approval/channels/telegram-api.ts` (thin client)
- Create: `packages/core/src/approval/channels/telegram-format.ts` (pure helpers)
- Test: `packages/core/tests/approval/telegram-format.test.ts`, `tests/approval/telegram-api.test.ts`

**Step 1 — Pure helpers TDD.** Implement + test:
- `parseCallback(data: string): { choice: "allow_once" | "deny"; token: string } | null` — regex `^ag:(allow_once|deny):(.+)$`; returns null for anything else (test: unknown choice, missing parts, empty, injection-y strings all → null).
- `promptText(p: SerializedPendingApproval): string` — Markdown; includes agent, tool, truncated args, reason, expiry.
- `truncateArgs(args, max=500): string` — `JSON.stringify` then cap length with an ellipsis.

**Step 2 — Telegram client TDD against a fake `fetch`.** `class TelegramApi { constructor(token) }` with `sendMessage`, `editMessageText`, `getUpdates({offset,timeout,allowed_updates})`, `answerCallbackQuery`. Inject `fetch` (default global) so tests pass a fake. Assert correct URL (`https://api.telegram.org/bot<token>/<method>`), body, and that a non-200 / `ok:false` response is surfaced as an error. Do NOT log the token.

**Step 3 — Commit:** `feat(approval): Telegram API client + pure format/callback helpers`

---

## Task D3: TelegramApprovalChannel (the real thing)

**Files:**
- Create: `packages/core/src/approval/channels/telegram.ts`
- Test: `packages/core/tests/approval/telegram-channel.test.ts`

**Step 1 — Test first, against a REAL `ApprovalQueue` + fake `TelegramApi`.** Scenarios (each its own test):
1. Queue emits `approval_request` → channel calls `sendMessage` to `owner_id` with an inline keyboard carrying `ag:allow_once:<token>` and `ag:deny:<token>`.
2. A `callback_query` from the owner with `ag:deny:<token>` → channel calls `queue.respond(id, {choice:"deny"})` (assert the queue's `request()` promise resolves with deny) and edits the message to a final state.
3. A `callback_query` from a NON-owner id → `queue.respond` is NOT called; an `answerCallbackQuery` with an "unauthorized" notice is sent. (Security test — must pass.)
4. Malformed/unknown `callback_data` → ignored, no respond.
5. `approval_resolved` from another channel (e.g. CLI watch) → the Telegram message is edited to "resolved elsewhere" and a later tap on it is a no-op.
6. `stop()` halts the getUpdates poll loop cleanly.

**Step 2 — Implement.** Constructor: `(queue, { api, ownerId })`. `start()`: subscribe to `approval_request`/`approval_resolved`; launch an async `getUpdates` long-poll loop (offset-tracked, `allowed_updates:["callback_query"]`, 30s) guarded by a `running` flag. Maintain a `token → approvalId` map (short token via a counter or `randomUUID().slice`). On owner tap: validate via `parseCallback`, look up the id, `queue.respond`, `answerCallbackQuery`, edit message. `stop()`: clear `running`, remove listeners. Token must NOT be logged. Poll-loop errors: catch, brief backoff, continue (don't kill the proxy).

**Step 3 — Wire into start.ts** replacing the D1 placeholder: resolve token from `token` or `process.env[token_env]`; if neither present, log a clear warning and skip the channel (don't crash). 

**Step 4 — Green + commit:** `feat(approval): in-core Telegram approval channel (phone-tap allow/deny)`

---

## Task D4: Config UX, docs, and the README demo upgrade

**Files:**
- Modify: `packages/core/src/cli/commands/init.ts` (optional prompt)
- Modify: `README.md` + `packages/core/README.md` (identical) — demo section
- Create: `docs/approval-channels.md` (how-to + security notes)

**Steps:**
1. `habena init`: optionally prompt "Enable Telegram phone-tap approvals? (needs a bot token + your chat id)"; if yes, write a `approval.channels.telegram` block (with `token_env: HABENA_TELEGRAM_TOKEN` recommended over inline). Keep it skippable and non-blocking.
2. `docs/approval-channels.md`: 60-second "create a bot with @BotFather, get your chat id, set `HABENA_TELEGRAM_TOKEN`, add the config block" guide + the security model (owner-only, allowlist, arg truncation).
3. README demo: replace the "phone-tap coming next" caveat with the real flow — agent hits a `require_approval` rule → phone buzzes → tap **Deny** → blocked + audited. Keep both READMEs byte-identical.
4. Commit: `docs: Telegram approval channel guide + README phone-tap demo`

---

## Task D5: Configurable timeout re-notify (the agentlab pain point) — OPTIONAL

The agentlab 5-min default-deny window was a real friction. Low priority; do only if D1–D4 land cleanly.
- Make the per-channel behavior: when an approval is ~30s from expiry and still pending, edit the Telegram message to warn "expiring soon" (no new message spam).
- Keep the proxy-level `timeout` / `timeout_action` config as the source of truth (already exists in `start.ts`).
- TDD with a fake timer. Commit: `feat(approval): warn before approval timeout in Telegram channel`

---

## Verification (whole phase)
- `cd packages/core && pnpm build && npx vitest run --exclude 'tests/ipc/**' --exclude 'tests/e2e/**'` green (the channel tests use a fake Telegram API + real queue, so they run in-sandbox — no sockets/network).
- Security tests (non-owner rejected, bad callback ignored) explicitly green.
- READMEs identical; documented config matches real `ApprovalConfig`.

## Open questions
- `allow_session` via chat: intentionally omitted for v1 (attack surface). Revisit only if asked.
- getUpdates vs webhook: getUpdates (long-poll) chosen — no public URL needed, ideal for a Mac-mini behind NAT.
