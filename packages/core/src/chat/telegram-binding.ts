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
      if (ev.kind === "status") {
        if (ev.state === "running") this.telegramRunActive = ev.channel === "telegram";
        // Run over (idle) or bridge gone (offline): no telegram run can be
        // active. Defensive reset so a stray `final` emitted outside any run
        // is never forwarded to the phone. (The manager emits `final` BEFORE
        // the closing `status idle`, so real replies still flow.)
        else if (ev.state === "idle" || ev.state === "offline") {
          // Capture BEFORE resetting: a run_state error surfaces as
          // `status idle` + `detail` (manager.ts) rather than a `final` event
          // — there is no other signal that a telegram-originated run just
          // failed. Check the flag as it was WHILE the run was active, not
          // after this same event resets it.
          const wasTelegramRun = this.telegramRunActive;
          this.telegramRunActive = false;
          if (ev.state === "idle" && ev.detail && wasTelegramRun) {
            this.safeSend("⚠️ Your assistant hit an error on that request — try again.");
          }
        }
      }
      if (ev.kind === "assistant_final" && this.telegramRunActive) this.safeSend(ev.text);
      if (ev.kind === "rejected" && ev.channel === "telegram") {
        this.safeSend(REJECTION_TEXT[ev.reason] ?? "Couldn't accept that message.");
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
  }

  /**
   * Outbound delivery is best-effort: a blocked bot, network error, or
   * Telegram rate limit makes send() reject, and an uncaught rejection here
   * would take down the whole proxy. Swallow it — the reply is lost (the web
   * dashboard still has it via the manager's history) but the binding keeps
   * working for the next event. start.ts's send additionally logs a
   * token-free warning before this catch sees anything.
   */
  private safeSend(text: string): void {
    void this.opts.send(text).catch(() => {});
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
