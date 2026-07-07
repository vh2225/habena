/**
 * Live Telegram approval channel — turns a `require_approval` decision into a
 * phone-tap Allow-once / Deny prompt in the owner's chat.
 *
 * SECURITY MODEL (this is the whole point of the file):
 *  - OWNER AUTH is the trust boundary. Every inbound callback_query is checked
 *    `String(cq.from.id) === String(ownerId)` BEFORE anything else; a non-owner
 *    tap is answered "Not authorized" and dropped. It can NEVER reach
 *    queue.respond(). There is no code path from a non-owner tap to a decision.
 *  - Every tap is parsed through `parseCallback` (an anchored, allowlisted
 *    regex), so the resolved choice is always in {allow_once, deny} and the
 *    token is non-empty.
 *  - ONE-SHOT consumption: each prompt has an unguessable token mapped to its
 *    approval. The map entry is deleted the instant we act on it (owner tap,
 *    resolved-elsewhere, or timeout), so a second tap on the same token finds
 *    nothing and is a no-op. No approval can be resolved twice from here.
 *  - The bot token is a secret and is NEVER logged or placed in any error/output
 *    by this channel (the TelegramApi client enforces the same).
 *  - TWO-CHANNEL CONFIRMATION (Task 8): an approval whose `origin` is
 *    "telegram" (the run itself was commanded from the phone) can NEVER be
 *    allowed from here — only denied. This is enforced twice: `buildKeyboard`
 *    (telegram-format.ts) never renders an Allow button for such a prompt,
 *    and — defense in depth, in case a client fabricates callback_data for a
 *    button that was never shown — `handleUpdate` below refuses to act on ANY
 *    non-deny tap for a telegram-origin prompt even though it parses and
 *    passes owner auth (default-deny: a future third CallbackChoice value
 *    fails closed here too). The token is NOT consumed in that case, so the
 *    still-live prompt's Deny path keeps working. Every later re-render of
 *    the prompt (the D5 "expiring soon" edit) re-supplies the SAME
 *    origin-aware text + keyboard captured at delivery, so an edit can never
 *    resurrect an Allow button. A phone commands; only the Mac dashboard
 *    (web origin, or no origin) can allow.
 */
import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../channel.js";
import type { ApprovalQueue } from "../queue.js";
import type { PendingApproval, ApprovalResponse } from "../types.js";
import { serializePending } from "../../ipc/protocol.js";
import type { SerializedPendingApproval } from "../../ipc/protocol.js";
import type { TelegramApi } from "./telegram-api.js";
import { parseCallback, promptText, buildKeyboard } from "./telegram-format.js";
import type { InlineKeyboard } from "./telegram-format.js";

interface TrackedPrompt {
  approvalId: string;
  chatId: string | number;
  messageId: number;
  /**
   * Which channel's run produced this approval ("web" | "telegram" |
   * undefined). SECURITY (Task 8): when "telegram", `handleUpdate` refuses to
   * resolve any non-deny tap for this prompt — see the header note above.
   */
  origin?: SerializedPendingApproval["origin"];
  /**
   * The prompt text and origin-aware keyboard exactly as delivered, reused
   * verbatim by the D5 warning edit. SECURITY (Task 8): re-renders must never
   * regenerate the keyboard without consulting origin — reusing the captured
   * one guarantees a telegram-origin prompt stays deny-only (and keeps its
   * Mac notice) across every edit.
   */
  text: string;
  keyboard: InlineKeyboard;
  /**
   * One-time "expiring soon" warning timer (D5). Cleared in EVERY consume path
   * and in stop(), so a consumed/stopped prompt never edits the message later.
   */
  warnTimer?: ReturnType<typeof setTimeout>;
}

export interface TelegramApprovalChannelOptions {
  api: TelegramApi;
  ownerId: string | number;
  /** Backoff after a failed getUpdates cycle, ms. Injectable for tests. */
  backoffMs?: number;
  /** Long-poll timeout passed to getUpdates, seconds. */
  pollTimeoutSec?: number;
  /**
   * Idle delay between poll cycles, ms. Acts as a hot-spin floor: even when
   * getUpdates returns an empty batch instantly (e.g. a misconfigured 0s
   * long-poll timeout, or a fake in tests), this guarantees the loop yields a
   * real macrotask each cycle so it can NEVER starve setTimeout/timers or peg a
   * CPU. Negligible in prod since getUpdates already blocks ~30s. Injectable so
   * tests can set it to 0 — a 0ms setTimeout is still a macrotask, which is what
   * breaks the starvation. Default 250ms.
   */
  idlePollMs?: number;
  /**
   * Whether start() spawns the background long-poll loop. Default true (prod).
   * Tests set false so they can subscribe the queue listeners via start() and
   * then drive pollOnce() by hand — no background poller racing on the fake
   * getUpdates / offset, so assertions stay deterministic.
   */
  autoPoll?: boolean;
  /**
   * D5: how long before `expiresAt` to send the owner a one-time "expiring soon"
   * heads-up in the chat (ms). Purely a courtesy edit — it does NOT change when
   * or how the approval actually times out (the queue's timeout is the source of
   * truth). Default 30000ms. If a delivered approval already has less than this
   * left, the warning fires ~immediately (delay clamped to 0).
   */
  warnBeforeMs?: number;
  /**
   * Owner text-command hook (e.g. "/lockdown", "/status"). Receives the
   * command line, returns reply text (or null for unknown commands). Owner
   * auth happens BEFORE this is called. Optional — without it, plain
   * messages are ignored as before.
   */
  onCommand?: (command: string) => Promise<string | null>;
}

export class TelegramApprovalChannel implements ApprovalChannel {
  readonly name = "telegram";

  private readonly queue: ApprovalQueue;
  private readonly api: TelegramApi;
  private readonly ownerId: string | number;
  private readonly backoffMs: number;
  private readonly pollTimeoutSec: number;
  private readonly idlePollMs: number;
  private readonly autoPoll: boolean;
  private readonly warnBeforeMs: number;
  private readonly onCommand?: (command: string) => Promise<string | null>;

  private running = false;
  private offset = 0;
  /** token -> prompt. Presence == "this tap is still actionable" (one-shot). */
  private readonly prompts = new Map<string, TrackedPrompt>();
  /** Reverse index so resolved-elsewhere / timeout can find the token by id. */
  private readonly tokenByApprovalId = new Map<string, string>();
  private loopPromise: Promise<void> | null = null;

  private readonly onRequest = (p: PendingApproval): void => {
    // Fire-and-forget; a send failure must never throw into the emitter.
    void this.handleRequest(p);
  };
  private readonly onResolved = (
    p: PendingApproval,
    response: ApprovalResponse
  ): void => {
    void this.handleResolvedElsewhere(p, response);
  };

  constructor(queue: ApprovalQueue, opts: TelegramApprovalChannelOptions) {
    this.queue = queue;
    this.api = opts.api;
    this.ownerId = opts.ownerId;
    this.backoffMs = opts.backoffMs ?? 1500;
    this.pollTimeoutSec = opts.pollTimeoutSec ?? 30;
    this.idlePollMs = opts.idlePollMs ?? 250;
    this.onCommand = opts.onCommand;
    this.autoPoll = opts.autoPoll ?? true;
    this.warnBeforeMs = opts.warnBeforeMs ?? 30000;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.queue.on("approval_request", this.onRequest);
    this.queue.on("approval_resolved", this.onResolved);
    if (this.autoPoll) {
      this.loopPromise = this.pollLoop();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.queue.off("approval_request", this.onRequest);
    this.queue.off("approval_resolved", this.onResolved);
    // D5: cancel every outstanding "expiring soon" warning timer so none fires
    // after stop() — no dangling timers, no edit on a stopped channel.
    for (const prompt of this.prompts.values()) {
      if (prompt.warnTimer) clearTimeout(prompt.warnTimer);
    }
    // Let the in-flight getUpdates settle; never propagate.
    const lp = this.loopPromise;
    this.loopPromise = null;
    if (lp) await lp.catch(() => {});
  }

  /** Deliver a new approval request to the owner's chat. */
  private async handleRequest(p: PendingApproval): Promise<void> {
    const token = randomUUID();
    try {
      const serialized = serializePending(p);
      const text = promptText(serialized);
      const keyboard = buildKeyboard(serialized, token);
      const sent = await this.api.sendMessage(this.ownerId, text, keyboard);
      // Only track once we actually have a message to edit later.
      const tracked: TrackedPrompt = {
        approvalId: p.id,
        chatId: this.ownerId,
        messageId: sent.message_id,
        origin: serialized.origin,
        text,
        keyboard,
      };
      this.prompts.set(token, tracked);
      this.tokenByApprovalId.set(p.id, token);
      this.scheduleWarning(token, tracked, p.expiresAt);
    } catch {
      // Telegram unreachable — the approval still lives in the queue and will
      // time out (or be answered via CLI watch). Do not throw; do not log the
      // error (it could carry transport detail) beyond silent best-effort.
    }
  }

  /**
   * Another surface (CLI watch) or a timeout resolved this approval. Finalize
   * the Telegram message and consume the token so a later tap is a no-op.
   *
   * Skips edits triggered by OUR OWN respond() — handleUpdate already edited the
   * message in that case and removed the token before calling respond().
   */
  private async handleResolvedElsewhere(
    p: PendingApproval,
    response: ApprovalResponse
  ): Promise<void> {
    const token = this.tokenByApprovalId.get(p.id);
    if (!token) return; // not ours, or already consumed by our own tap
    const prompt = this.prompts.get(token);
    this.consume(token, p.id);
    if (!prompt) return;
    const note = response.note === "telegram" ? "" : " elsewhere";
    try {
      await this.api.editMessageText(
        prompt.chatId,
        prompt.messageId,
        `↪️ Resolved${note} (${response.choice})`
      );
    } catch {
      // best-effort
    }
  }

  /**
   * One long-poll cycle. Errors are swallowed (a Telegram outage must not crash
   * the proxy); the loop backs off and retries.
   *
   * CRITICAL — anti-starvation: every path ends with a REAL `setTimeout`-based
   * `delay` (a macrotask). Without this, the empty-success path would return
   * after only microtasks, and `pollLoop`'s `while(running) await pollOnce()`
   * would microtask-hot-spin and starve all `setTimeout`s (incl. the approval
   * queue's timeout and any test timers) and peg a CPU. A 0ms delay is still a
   * macrotask, so it breaks the starvation while staying negligible in prod
   * (getUpdates already long-polls ~30s).
   */
  async pollOnce(): Promise<void> {
    if (!this.running) return;
    let updates: import("./telegram-api.js").TelegramUpdate[];
    try {
      updates = await this.api.getUpdates(this.offset, this.pollTimeoutSec);
    } catch {
      // Telegram outage: back off, then yield a macrotask before retrying.
      await delay(this.backoffMs);
      return;
    }
    for (const update of updates) {
      this.offset = Math.max(this.offset, update.update_id + 1);
      try {
        await this.handleUpdate(update);
      } catch {
        // A single bad update must not abort the batch or the loop.
      }
    }
    // Always yield a macrotask between cycles — this is the hot-spin floor.
    await delay(this.idlePollMs);
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      await this.pollOnce();
    }
  }

  private async handleUpdate(
    update: import("./telegram-api.js").TelegramUpdate
  ): Promise<void> {
    // Owner text commands (/lockdown, /status, ...). Same trust boundary as
    // taps: sender id must match the owner before anything else happens.
    const msg = update.message;
    if (msg?.text?.startsWith("/") && this.onCommand) {
      if (String(msg.from?.id ?? "") !== String(this.ownerId)) return;
      const reply = await this.onCommand(msg.text.trim()).catch(
        (err: Error) => `Command failed: ${err.message}`
      );
      if (reply) await this.api.sendMessage(msg.chat.id, reply).catch(() => {});
      return;
    }

    const cq = update.callback_query;
    if (!cq) return;

    // ── TRUST BOUNDARY: owner auth, before ANY other handling. ──────────────
    if (String(cq.from.id) !== String(this.ownerId)) {
      await this.api.answerCallbackQuery(cq.id, "Not authorized").catch(() => {});
      return;
    }

    // Every tap goes through the allowlisted parser.
    const parsed = parseCallback(cq.data ?? "");
    if (!parsed) {
      await this.api.answerCallbackQuery(cq.id).catch(() => {});
      return;
    }

    const prompt = this.prompts.get(parsed.token);
    if (!prompt) {
      // Unknown or already-consumed token (one-shot): nothing to resolve.
      await this.api.answerCallbackQuery(cq.id, "Already handled").catch(() => {});
      return;
    }

    // SECURITY (Task 8, defense in depth): buildKeyboard() never renders an
    // Allow button for a telegram-origin prompt, but this guard covers a
    // forged/replayed callback_data that names an allow choice anyway.
    // Default-deny: anything that is not literally "deny" is refused, so a
    // future third CallbackChoice value fails closed too. Answer and return
    // WITHOUT consuming the token or calling queue.respond() — the prompt
    // stays live so a genuine Deny tap on the same token still works.
    if (prompt.origin === "telegram" && parsed.choice !== "deny") {
      await this.api
        .answerCallbackQuery(cq.id, "Approve from your Mac dashboard")
        .catch(() => {});
      return;
    }

    // Consume FIRST so a concurrent/duplicate tap can't reach respond() twice.
    this.consume(parsed.token, prompt.approvalId);

    this.queue.respond(prompt.approvalId, {
      choice: parsed.choice,
      note: "telegram",
    });

    await this.api.answerCallbackQuery(cq.id).catch(() => {});
    const finalText =
      parsed.choice === "allow_once" ? "✅ Allowed once" : "⛔ Denied";
    await this.api
      .editMessageText(prompt.chatId, prompt.messageId, finalText)
      .catch(() => {});
  }

  /**
   * D5: schedule a single "expiring soon" edit at `expiresAt - warnBeforeMs`.
   * Fires at most once, and ONLY if the token is still pending (not consumed).
   * It is a best-effort outbound edit — it never resolves the queue, never
   * throws, never logs the token. The timer is unref'd so it can't keep the
   * process alive past stop(), and it's stored on the prompt so consume()/stop()
   * can clear it.
   */
  private scheduleWarning(
    token: string,
    tracked: TrackedPrompt,
    expiresAt: Date
  ): void {
    const delayMs = Math.max(
      0,
      expiresAt.getTime() - Date.now() - this.warnBeforeMs
    );
    const timer = setTimeout(() => {
      // Re-check by identity: the entry must still be THIS prompt (not consumed,
      // not replaced). If it was consumed, the warning is a no-op.
      if (this.prompts.get(token) !== tracked) return;
      // Re-render the ORIGINAL prompt text (Mac notice included for
      // telegram-origin approvals) with the warning appended, and re-supply
      // the SAME origin-aware keyboard — a text edit without reply_markup
      // would strip the buttons, and regenerating them without consulting
      // origin could resurrect an Allow button (Task 8 invariant).
      void this.api
        .editMessageText(
          tracked.chatId,
          tracked.messageId,
          `${tracked.text}\n\n⏳ Expiring soon — tap to decide before this approval times out.`,
          tracked.keyboard
        )
        .catch(() => {
          // best-effort; swallow (transport detail must not surface)
        });
    }, delayMs);
    timer.unref?.();
    tracked.warnTimer = timer;
  }

  /** One-shot: drop both indexes so the token can never act again. */
  private consume(token: string, approvalId: string): void {
    const prompt = this.prompts.get(token);
    if (prompt?.warnTimer) clearTimeout(prompt.warnTimer);
    this.prompts.delete(token);
    this.tokenByApprovalId.delete(approvalId);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
