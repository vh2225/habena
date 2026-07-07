import { describe, it, expect, beforeEach } from "vitest";
import { TelegramChatBinding } from "../../src/chat/telegram-binding.js";
import { ChatChannelManager } from "../../src/chat/manager.js";
import type { AgentBridge, BridgeEvent } from "../../src/chat/types.js";

class StubBridge implements AgentBridge {           // same double as manager.test.ts
  readonly kind = "stub"; up = true; sent: string[] = [];
  failNext = false;
  private cbs = new Set<(ev: BridgeEvent) => void>();
  async start() {} async stop() {} isUp() { return this.up; }
  onEvent(cb: (ev: BridgeEvent) => void) { this.cbs.add(cb); return () => this.cbs.delete(cb); }
  emit(ev: BridgeEvent) { for (const cb of this.cbs) cb(ev); }
  async send(text: string) {
    if (this.failNext) { this.failNext = false; throw new Error("send failed"); }
    this.sent.push(text);
  }
}

let bridge: StubBridge; let mgr: ChatChannelManager; let sent: string[]; let binding: TelegramChatBinding;
beforeEach(() => {
  bridge = new StubBridge();
  mgr = new ChatChannelManager({ bridge });
  sent = [];
  binding = new TelegramChatBinding({ manager: mgr, ownerId: 42, send: async (t) => { sent.push(t); } });
  binding.start();
});

describe("TelegramChatBinding", () => {
  it("routes owner text to the manager and returns the final reply to telegram", () => {
    binding.handleMessage("what is on my calendar?");
    expect(bridge.sent).toEqual(["what is on my calendar?"]);
    bridge.emit({ kind: "final", text: "Two meetings." });
    bridge.emit({ kind: "run_state", state: "finished" });
    expect(sent).toEqual(["Two meetings."]);
  });

  it("does not send web-originated replies to telegram", () => {
    mgr.handleInbound({ channel: "web", sender: "local", text: "hi" });
    bridge.emit({ kind: "final", text: "web answer" });
    bridge.emit({ kind: "run_state", state: "finished" });
    expect(sent).toEqual([]);
  });

  // Deviation (authorized during Task 6 review, applied in Task 10): the
  // manager emits a `rejected` event for EVERY rejection path — including
  // immediate ones — so the binding reacts purely to that event stream
  // rather than to handleMessage's synchronous return value. This test
  // exercises the immediate-offline path and asserts the reply arrives via
  // the event, not via a direct check of handleInbound's return.
  it("sends a human-readable rejection via the rejected event when the bridge is offline", () => {
    bridge.up = false;
    binding.handleMessage("hello?");
    expect(sent.some((t) => /offline/i.test(t))).toBe(true);
  });

  // Deviation coverage: a message that gets queued (accepted at inbound time,
  // so handleMessage's old return-value check would have seen `accepted:
  // true` and sent nothing) can still be rejected later when the bridge goes
  // down and the manager flushes the queue. That flush-time `rejected` event
  // (reason "offline") is only visible via the event stream, and must
  // produce exactly one send — no double-send from any return-value path.
  it("sends the offline text exactly once when a queued message is flushed on disconnect", () => {
    binding.handleMessage("first"); // starts a run; drains immediately
    binding.handleMessage("second"); // queued behind the active run
    expect(sent).toEqual([]); // nothing rejected yet — both were accepted
    bridge.emit({ kind: "connection", state: "down" }); // flushes the queue
    expect(sent.filter((t) => /offline/i.test(t))).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  // Deviation coverage: the other queue-flush reason the manager can emit
  // (drain()'s bridge.send() rejection) — also only visible via the event.
  // bridge.send() rejects asynchronously (it's an async function throwing),
  // so drain()'s `.catch()` runs on a later microtask — flush one tick.
  it("sends a rejection exactly once when the active send itself fails", async () => {
    bridge.failNext = true;
    binding.handleMessage("will fail");
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toMatch(/offline/i); // send_failed has its own text
  });

  // A blocked bot / network error / Telegram rate limit makes send() reject.
  // That rejection must be swallowed inside the binding — an unhandled
  // rejection here would crash the whole proxy — and must not wedge the
  // binding: later events still get delivered.
  it("swallows send() rejections and keeps delivering later events", async () => {
    binding.stop(); // replace the default (always-succeeding) binding
    let failFirst = true;
    const flaky = new TelegramChatBinding({
      manager: mgr,
      ownerId: 42,
      send: async (t) => {
        if (failFirst) {
          failFirst = false;
          throw new Error("Telegram sendMessage failed: 403");
        }
        sent.push(t);
      },
    });
    flaky.start();
    try {
      flaky.handleMessage("one");
      bridge.emit({ kind: "final", text: "reply one" }); // send() rejects here
      bridge.emit({ kind: "run_state", state: "finished" });
      // Let the rejected promise settle — if the binding didn't .catch it,
      // vitest's unhandled-rejection detector fails the run.
      await new Promise((r) => setTimeout(r, 0));
      flaky.handleMessage("two");
      bridge.emit({ kind: "final", text: "reply two" });
      expect(sent).toEqual(["reply two"]); // first was lost to the outage, second flows
    } finally {
      flaky.stop();
    }
  });

  // Defensive: telegramRunActive must reset when the run ends (status
  // idle/offline), so a stray final emitted outside any telegram run is
  // never forwarded to the phone.
  it("does not forward a stray final after the telegram run finished", () => {
    binding.handleMessage("question");
    bridge.emit({ kind: "final", text: "answer" });
    bridge.emit({ kind: "run_state", state: "finished" }); // manager emits status idle
    bridge.emit({ kind: "final", text: "stray" }); // no run active
    expect(sent).toEqual(["answer"]);
  });

  // The manager now turns a run_state error into `status idle` + `detail`
  // (not `offline` — see manager.ts/manager.test.ts). The binding must notice
  // this specifically for a telegram-originated run and tell the phone the
  // request failed, since no `final`/`rejected` event ever fires for it.
  it("sends an error notice exactly once when a telegram-originated run errors", () => {
    binding.handleMessage("question");
    bridge.emit({ kind: "run_state", state: "error", detail: "boom" });
    expect(sent).toEqual(["⚠️ Your assistant hit an error on that request — try again."]);
  });

  it("does not send an error notice when a web-originated run errors", () => {
    mgr.handleInbound({ channel: "web", sender: "local", text: "hi" });
    bridge.emit({ kind: "run_state", state: "error", detail: "boom" });
    expect(sent).toEqual([]);
  });
});
