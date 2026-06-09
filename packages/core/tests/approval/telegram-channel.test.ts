import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ApprovalQueue } from "../../src/approval/queue.js";
import { TelegramApprovalChannel } from "../../src/approval/channels/telegram.js";
import type { TelegramUpdate } from "../../src/approval/channels/telegram-api.js";
import type { PolicyDecision } from "../../src/policy/decisions.js";
import type { ToolCallRequest } from "../../src/proxy/server.js";

function sampleDecision(): PolicyDecision {
  return {
    action: "require_approval",
    reason: "needs a human",
    tool: "gmail_send",
    enforcement: "soft_mandatory",
    risk_level: "medium",
    tier: "user",
  };
}

function sampleRequest(): ToolCallRequest {
  return {
    agentType: "openclaw",
    instanceId: "openclaw/session-x",
    tool: "gmail_send",
    args: { to: "bob@example.com" },
    estimatedCost: 0,
  };
}

interface SentMessage {
  chatId: string | number;
  text: string;
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>;
}
interface EditedMessage {
  chatId: string | number;
  messageId: number;
  text: string;
}
interface AnsweredCallback {
  cqId: string;
  text?: string;
}

/**
 * Fake Telegram client. Records every outbound call and lets the test feed
 * `getUpdates` a queue of update batches; once drained it returns `[]` so the
 * poll loop idles. `nextMessageId` makes sendMessage hand back a known id.
 */
class FakeTelegramApi {
  sent: SentMessage[] = [];
  edited: EditedMessage[] = [];
  answered: AnsweredCallback[] = [];
  private updateBatches: TelegramUpdate[][] = [];
  private nextMessageId = 100;

  async sendMessage(
    chatId: string | number,
    text: string,
    inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>
  ): Promise<{ message_id: number }> {
    this.sent.push({ chatId, text, inlineKeyboard });
    return { message_id: this.nextMessageId++ };
  }

  async editMessageText(
    chatId: string | number,
    messageId: number,
    text: string
  ): Promise<void> {
    this.edited.push({ chatId, messageId, text });
  }

  async answerCallbackQuery(cqId: string, text?: string): Promise<void> {
    this.answered.push({ cqId, text });
  }

  async getUpdates(_offset: number, _timeoutSec: number): Promise<TelegramUpdate[]> {
    return this.updateBatches.shift() ?? [];
  }

  /** Test helper: queue a batch of updates to be returned by the next getUpdates. */
  inject(batch: TelegramUpdate[]): void {
    this.updateBatches.push(batch);
  }
}

/** Build a callback_query update from a given user id with the given data. */
function callbackUpdate(
  updateId: number,
  fromId: number,
  data: string,
  messageId = 100,
  chatId = 42
): TelegramUpdate {
  return {
    update_id: updateId,
    callback_query: {
      id: `cq-${updateId}`,
      from: { id: fromId },
      data,
      message: { message_id: messageId, chat: { id: chatId } },
    },
  };
}

/** Pull the token out of the keyboard's first button's callback_data. */
function tokenFromKeyboard(msg: SentMessage): string {
  const data = msg.inlineKeyboard![0][0].callback_data;
  const m = /^ag:allow_once:(.+)$/.exec(data);
  if (!m) throw new Error(`unexpected callback_data: ${data}`);
  return m[1];
}

const OWNER_ID = 777;

describe("TelegramApprovalChannel", () => {
  let queue: ApprovalQueue;
  let api: FakeTelegramApi;
  let channel: TelegramApprovalChannel;

  beforeEach(async () => {
    queue = new ApprovalQueue();
    api = new FakeTelegramApi();
    // autoPoll:false — start() subscribes the queue listeners but does NOT
    // spawn the background long-poll loop, so we drive pollOnce() by hand with
    // no background poller racing on the fake getUpdates/offset. backoffMs:0 /
    // idlePollMs:0 keep each pollOnce a single real (0ms) macrotask tick.
    channel = new TelegramApprovalChannel(queue, {
      api: api as never,
      ownerId: OWNER_ID,
      backoffMs: 0,
      idlePollMs: 0,
      autoPoll: false,
    });
  });

  afterEach(async () => {
    await channel.stop();
    queue.shutdown();
  });

  it("1. sends an approval prompt with allow/deny buttons sharing one token", async () => {
    await channel.start();
    void queue.request(sampleDecision(), sampleRequest(), 60000);
    // request emits synchronously, so sendMessage has already been recorded.
    expect(api.sent).toHaveLength(1);
    const msg = api.sent[0];
    expect(String(msg.chatId)).toBe(String(OWNER_ID));
    const kb = msg.inlineKeyboard!;
    const allowData = kb[0][0].callback_data;
    const denyData = kb[0][1].callback_data;
    const tAllow = /^ag:allow_once:(.+)$/.exec(allowData)![1];
    const tDeny = /^ag:deny:(.+)$/.exec(denyData)![1];
    expect(tAllow).toBe(tDeny);
    expect(tAllow.length).toBeGreaterThan(0);
  });

  it("2. owner deny resolves the queue and marks the message denied", async () => {
    await channel.start();
    const p = queue.request(sampleDecision(), sampleRequest(), 60000);
    const token = tokenFromKeyboard(api.sent[0]);

    api.inject([callbackUpdate(1, OWNER_ID, `ag:deny:${token}`)]);
    await channel.pollOnce();

    const res = await p;
    expect(res.choice).toBe("deny");
    expect(api.answered.some((a) => a.cqId === "cq-1")).toBe(true);
    expect(api.edited.some((e) => /deny|denied|⛔/i.test(e.text))).toBe(true);
  });

  it("3. owner allow_once resolves the queue to allow_once", async () => {
    await channel.start();
    const p = queue.request(sampleDecision(), sampleRequest(), 60000);
    const token = tokenFromKeyboard(api.sent[0]);

    api.inject([callbackUpdate(1, OWNER_ID, `ag:allow_once:${token}`)]);
    await channel.pollOnce();

    const res = await p;
    expect(res.choice).toBe("allow_once");
    expect(api.edited.some((e) => /allow|allowed|✅/i.test(e.text))).toBe(true);
  });

  it("4. SECURITY: a tap from a non-owner is rejected and never resolves the queue", async () => {
    await channel.start();
    const p = queue.request(sampleDecision(), sampleRequest(), 60000);
    const token = tokenFromKeyboard(api.sent[0]);

    let resolved = false;
    void p.then(() => {
      resolved = true;
    });

    const ATTACKER_ID = 999;
    api.inject([callbackUpdate(1, ATTACKER_ID, `ag:deny:${token}`)]);
    await channel.pollOnce();
    // give any stray microtasks a chance to (wrongly) resolve the promise
    await Promise.resolve();

    expect(resolved).toBe(false);
    expect(queue.list()).toHaveLength(1); // still pending
    // attacker got an "unauthorized" notice on their callback query
    const ans = api.answered.find((a) => a.cqId === "cq-1");
    expect(ans).toBeDefined();
    expect((ans!.text ?? "").toLowerCase()).toContain("authoriz");
    // no edit to the owner's message
    expect(api.edited).toHaveLength(0);
  });

  it("5. a malformed/disallowed callback from the owner is ignored (no resolve)", async () => {
    await channel.start();
    const p = queue.request(sampleDecision(), sampleRequest(), 60000);
    const token = tokenFromKeyboard(api.sent[0]);

    let resolved = false;
    void p.then(() => {
      resolved = true;
    });

    // allow_session is NOT in the parseCallback allowlist; garbage is junk.
    api.inject([
      callbackUpdate(1, OWNER_ID, `ag:allow_session:${token}`),
      callbackUpdate(2, OWNER_ID, "garbage"),
    ]);
    await channel.pollOnce();
    await Promise.resolve();

    expect(resolved).toBe(false);
    expect(queue.list()).toHaveLength(1);
  });

  it("6. resolved elsewhere: a CLI-watch respond edits the message and a later tap is a no-op", async () => {
    await channel.start();
    const p = queue.request(sampleDecision(), sampleRequest(), 60000);
    // Let handleRequest finish sending & registering the token before we
    // simulate the out-of-band resolve (in prod sendMessage is a real network
    // round-trip; here we just flush its microtasks).
    await new Promise((r) => setTimeout(r, 0));
    const token = tokenFromKeyboard(api.sent[0]);
    const pending = queue.list()[0];

    // CLI watch / another channel responds directly via the queue.
    queue.respond(pending.id, { choice: "allow_once", note: "cli" });
    const res = await p;
    expect(res.choice).toBe("allow_once");
    // handleResolvedElsewhere edits asynchronously; flush its microtasks.
    await new Promise((r) => setTimeout(r, 0));

    // The channel should have edited the Telegram message to a final state.
    expect(api.edited.length).toBeGreaterThan(0);
    const editsBefore = api.edited.length;
    const answeredBefore = api.answered.length;

    // A later owner tap on the now-consumed token must NOT double-respond.
    api.inject([callbackUpdate(5, OWNER_ID, `ag:deny:${token}`)]);
    await channel.pollOnce();

    // queue already resolved & removed — respond on it is a no-op by design,
    // but more importantly the channel must treat the token as consumed.
    expect(queue.list()).toHaveLength(0);
    // No new edit applying a *new* resolution; at most an "already handled"
    // answerCallbackQuery. The token map no longer holds the entry.
    expect(api.edited.length).toBe(editsBefore);
    // It may answer the stale tap, but must not have routed a fresh respond.
    expect(api.answered.length).toBeGreaterThanOrEqual(answeredBefore);
  });

  it("7. stop() halts the loop cleanly and no further updates are consumed", async () => {
    await channel.start();
    void queue.request(sampleDecision(), sampleRequest(), 60000);
    const token = tokenFromKeyboard(api.sent[0]);

    await expect(channel.stop()).resolves.toBeUndefined();

    // After stop, pollOnce is a no-op: an injected tap is not processed.
    api.inject([callbackUpdate(9, OWNER_ID, `ag:deny:${token}`)]);
    await channel.pollOnce();
    expect(api.answered.some((a) => a.cqId === "cq-9")).toBe(false);
  });

  it("does not crash the loop when getUpdates throws (Telegram outage)", async () => {
    const throwingApi = {
      sent: [] as SentMessage[],
      async sendMessage() {
        return { message_id: 1 };
      },
      async editMessageText() {},
      async answerCallbackQuery() {},
      calls: 0,
      async getUpdates() {
        this.calls++;
        throw new Error("network down");
      },
    };
    const c = new TelegramApprovalChannel(queue, {
      api: throwingApi as never,
      ownerId: OWNER_ID,
      backoffMs: 0,
      idlePollMs: 0,
      autoPoll: false,
    });
    await c.start();
    // pollOnce must swallow the error rather than reject.
    await expect(c.pollOnce()).resolves.toBeUndefined();
    await c.stop();
  });

  it("8. background loop (autoPoll) does not hot-spin / starve timers on empty getUpdates", async () => {
    // REGRESSION: the empty-success path used to return after only microtasks,
    // so `while(running) await pollOnce()` microtask-hot-spun and starved every
    // setTimeout (incl. this test's). Here getUpdates returns [] instantly and
    // the loop runs for real; a setTimeout MUST still fire if timers aren't
    // starved. idlePollMs:0 keeps it a 0ms macrotask tick (fast but not a spin).
    let pollCount = 0;
    const spinApi = {
      async sendMessage() {
        return { message_id: 1 };
      },
      async editMessageText() {},
      async answerCallbackQuery() {},
      async getUpdates(): Promise<TelegramUpdate[]> {
        pollCount++;
        return []; // always empty, returns synchronously — the trap.
      },
    };
    const c = new TelegramApprovalChannel(queue, {
      api: spinApi as never,
      ownerId: OWNER_ID,
      backoffMs: 0,
      idlePollMs: 0,
      autoPoll: true, // run the REAL background loop
    });
    await c.start();

    // If timers are starved this setTimeout never resolves and the test times
    // out. With the macrotask-yield fix it resolves promptly.
    const timerFired = await new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(true), 20);
    });
    expect(timerFired).toBe(true);
    // The loop actually ran multiple cycles (it polled), not blocked.
    expect(pollCount).toBeGreaterThan(0);

    await c.stop(); // must settle cleanly, not hang
  });

  describe("D5: expiring-soon warning", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("9. warns exactly once shortly before the approval times out", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      // warnBeforeMs:10000 with a 60s expiry → warning fires at t=50s.
      const c = new TelegramApprovalChannel(queue, {
        api: api as never,
        ownerId: OWNER_ID,
        autoPoll: false,
        warnBeforeMs: 10000,
      });
      await c.start();
      void queue.request(sampleDecision(), sampleRequest(), 60000);
      // handleRequest awaits sendMessage (a resolved promise) before scheduling.
      await vi.advanceTimersByTimeAsync(0);
      expect(api.sent).toHaveLength(1);
      expect(api.edited).toHaveLength(0); // nothing yet

      // Advance to just before the warning window — still nothing.
      await vi.advanceTimersByTimeAsync(49000);
      expect(api.edited).toHaveLength(0);

      // Cross the warning instant.
      await vi.advanceTimersByTimeAsync(2000);
      const warnEdits = api.edited.filter((e) => /expir/i.test(e.text));
      expect(warnEdits).toHaveLength(1);
      expect(String(warnEdits[0].chatId)).toBe(String(OWNER_ID));

      // Keep advancing well past — still exactly one (no spam, no repeat).
      await vi.advanceTimersByTimeAsync(60000);
      expect(api.edited.filter((e) => /expir/i.test(e.text))).toHaveLength(1);

      await c.stop();
    });

    it("10. no warning fires after the owner resolves before the window", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      const c = new TelegramApprovalChannel(queue, {
        api: api as never,
        ownerId: OWNER_ID,
        backoffMs: 0,
        idlePollMs: 0,
        autoPoll: false,
        warnBeforeMs: 10000,
      });
      await c.start();
      const p = queue.request(sampleDecision(), sampleRequest(), 60000);
      await vi.advanceTimersByTimeAsync(0);
      const token = tokenFromKeyboard(api.sent[0]);

      // Owner taps Deny well before the warning window (t≈1s).
      await vi.advanceTimersByTimeAsync(1000);
      api.inject([callbackUpdate(1, OWNER_ID, `ag:deny:${token}`)]);
      // pollOnce ends in a real (faked) delay(idlePollMs); advance concurrently
      // so it settles under fake timers instead of hanging.
      await Promise.all([c.pollOnce(), vi.advanceTimersByTimeAsync(1)]);
      const res = await p;
      expect(res.choice).toBe("deny");

      const editsAfterResolve = api.edited.length;
      expect(api.edited.some((e) => /deny|denied|⛔/i.test(e.text))).toBe(true);

      // Advance past when the warning WOULD have fired (t=50s and beyond).
      await vi.advanceTimersByTimeAsync(120000);
      // No "expiring" edit, and no extra edits beyond the resolution edit.
      expect(api.edited.some((e) => /expir/i.test(e.text))).toBe(false);
      expect(api.edited.length).toBe(editsAfterResolve);

      await c.stop();
    });

    it("11. stop() cancels pending warning timers — none fire afterward", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      const c = new TelegramApprovalChannel(queue, {
        api: api as never,
        ownerId: OWNER_ID,
        autoPoll: false,
        warnBeforeMs: 10000,
      });
      await c.start();
      void queue.request(sampleDecision(), sampleRequest(), 60000);
      await vi.advanceTimersByTimeAsync(0);
      expect(api.sent).toHaveLength(1);

      await c.stop();

      // Advance well past the warning instant — the timer was cleared on stop().
      await vi.advanceTimersByTimeAsync(120000);
      expect(api.edited.some((e) => /expir/i.test(e.text))).toBe(false);
    });
  });
});
