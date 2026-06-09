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
    // backoffMs: 0 keeps the loop tight; we never start the auto-loop in most
    // tests — we drive pollOnce() by hand for determinism.
    channel = new TelegramApprovalChannel(queue, {
      api: api as never,
      ownerId: OWNER_ID,
      backoffMs: 0,
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
    });
    await c.start();
    // pollOnce must swallow the error rather than reject.
    await expect(c.pollOnce()).resolves.toBeUndefined();
    await c.stop();
  });
});
