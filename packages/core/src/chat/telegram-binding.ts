// packages/core/src/chat/telegram-binding.ts
import type { ChatChannelManager } from "./manager.js";
import type { ChatEvent } from "./types.js";

export interface TelegramChatBindingOptions {
  manager: ChatChannelManager;
  send: (text: string) => Promise<void>;
  ownerId: string | number;
}

const REJECTION_TEXT: Record<string, string> = {
  rate_limited: "⏳ Rate limit tripped for Telegram. Re-arm from the dashboard or `habena chat rearm telegram`.",
  offline: "🔌 Your assistant is offline right now.",
  busy: "⏱ Busy with another request — try again in a moment.",
  empty: "Send some text to talk to your assistant.",
  // Deviation (authorized during Task 6's review, applied here): the manager
  // can reject an already-queued message asynchronously — either because the
  // bridge went down before its turn (queue flush, reason "offline", already
  // covered above) or because the active send itself failed (drain()'s
  // catch, reason "send_failed"). Neither is visible to handleMessage's
  // synchronous return value, only to the event stream — see start() below.
  send_failed: "⚠️ Your message couldn't reach the assistant — it may be restarting. Try again.",
};

/**
 * Glue between the Telegram approval channel's inbound text hook and the
 * chat manager.
 *
 * Fully event-driven (deviation from the original plan, decided during
 * Task 6's review): the manager emits a `rejected` event for EVERY rejection
 * path — immediate (empty/offline/rate_limited/busy, synchronous during
 * handleInbound) AND deferred (queue-flush on disconnect, or a failed send,
 * both asynchronous and invisible to handleInbound's return value). Reacting
 * only to `rejected` events — for every reason, not just the immediate ones —
 * means `handleMessage()` itself never inspects `manager.handleInbound`'s
 * return value, so there is exactly one send path per rejection and no risk
 * of a double-send between a return-value check and the event.
 */
export class TelegramChatBinding {
  private unsubscribe?: () => void;
  private telegramRunActive = false;

  constructor(private readonly opts: TelegramChatBindingOptions) {}

  start(): void {
    this.unsubscribe = this.opts.manager.subscribe((ev: ChatEvent) => {
      if (ev.kind === "status" && ev.state === "running") this.telegramRunActive = ev.channel === "telegram";
      if (ev.kind === "assistant_final" && this.telegramRunActive) void this.opts.send(ev.text);
      if (ev.kind === "rejected" && ev.channel === "telegram") {
        void this.opts.send(REJECTION_TEXT[ev.reason] ?? "Couldn't accept that message.");
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
  }

  /** Wire into TelegramApprovalChannel's onChatMessage hook. */
  handleMessage(text: string): void {
    // Rejections (immediate or deferred) are handled entirely by the
    // `rejected` event in start() above — do not branch on the return value
    // here, or a rejection could be reported twice.
    this.opts.manager.handleInbound({
      channel: "telegram",
      sender: String(this.opts.ownerId),
      text,
    });
  }
}
