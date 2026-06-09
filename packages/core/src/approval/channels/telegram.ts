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
 */
import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../channel.js";
import type { ApprovalQueue } from "../queue.js";
import type { PendingApproval, ApprovalResponse } from "../types.js";
import { serializePending } from "../../ipc/protocol.js";
import type { TelegramApi } from "./telegram-api.js";
import { parseCallback, promptText } from "./telegram-format.js";

interface TrackedPrompt {
  approvalId: string;
  chatId: string | number;
  messageId: number;
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
    this.autoPoll = opts.autoPoll ?? true;
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
    // Let the in-flight getUpdates settle; never propagate.
    const lp = this.loopPromise;
    this.loopPromise = null;
    if (lp) await lp.catch(() => {});
  }

  /** Deliver a new approval request to the owner's chat. */
  private async handleRequest(p: PendingApproval): Promise<void> {
    const token = randomUUID();
    try {
      const text = promptText(serializePending(p));
      const sent = await this.api.sendMessage(this.ownerId, text, [
        [
          { text: "✅ Allow once", callback_data: `ag:allow_once:${token}` },
          { text: "⛔ Deny", callback_data: `ag:deny:${token}` },
        ],
      ]);
      // Only track once we actually have a message to edit later.
      this.prompts.set(token, {
        approvalId: p.id,
        chatId: this.ownerId,
        messageId: sent.message_id,
      });
      this.tokenByApprovalId.set(p.id, token);
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

  /** One-shot: drop both indexes so the token can never act again. */
  private consume(token: string, approvalId: string): void {
    this.prompts.delete(token);
    this.tokenByApprovalId.delete(approvalId);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
