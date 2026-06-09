import { describe, it, expect } from "vitest";
import { TelegramApi } from "../../src/approval/channels/telegram-api.js";

const TOKEN = "123456:SECRET-BOT-TOKEN-do-not-leak";

interface RecordedCall {
  url: string;
  body: any;
}

/** Build a fake fetch that records calls and returns a canned response. */
function fakeFetch(
  responder: (url: string, body: any) => { status?: number; json: any }
) {
  const calls: RecordedCall[] = [];
  const impl = (async (input: any, init?: any) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    const { status = 200, json } = responder(url, body);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("TelegramApi.sendMessage", () => {
  it("posts to the correct URL with chat_id, text, and reply_markup", async () => {
    const { impl, calls } = fakeFetch(() => ({
      json: { ok: true, result: { message_id: 99 } },
    }));
    const api = new TelegramApi(TOKEN, impl);

    const keyboard = [
      [
        { text: "Allow once", callback_data: "ag:allow_once:1" },
        { text: "Deny", callback_data: "ag:deny:1" },
      ],
    ];
    const res = await api.sendMessage("12345", "hello", keyboard);

    expect(res.message_id).toBe(99);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`
    );
    expect(calls[0].body.chat_id).toBe("12345");
    expect(calls[0].body.text).toBe("hello");
    expect(calls[0].body.reply_markup.inline_keyboard).toEqual(keyboard);
    expect(calls[0].body.parse_mode).toBe("Markdown");
    expect(calls[0].body.disable_web_page_preview).toBe(true);
  });

  it("omits reply_markup when no keyboard is passed", async () => {
    const { impl, calls } = fakeFetch(() => ({
      json: { ok: true, result: { message_id: 1 } },
    }));
    const api = new TelegramApi(TOKEN, impl);
    await api.sendMessage(777, "no buttons");
    expect(calls[0].body.reply_markup).toBeUndefined();
    expect(calls[0].body.chat_id).toBe(777);
  });
});

describe("TelegramApi.editMessageText", () => {
  it("posts message_id and text with Markdown + no preview", async () => {
    const { impl, calls } = fakeFetch(() => ({
      json: { ok: true, result: { message_id: 5 } },
    }));
    const api = new TelegramApi(TOKEN, impl);
    await api.editMessageText("12345", 5, "edited");
    expect(calls[0].url).toBe(
      `https://api.telegram.org/bot${TOKEN}/editMessageText`
    );
    expect(calls[0].body.chat_id).toBe("12345");
    expect(calls[0].body.message_id).toBe(5);
    expect(calls[0].body.text).toBe("edited");
    expect(calls[0].body.parse_mode).toBe("Markdown");
    expect(calls[0].body.disable_web_page_preview).toBe(true);
  });
});

describe("TelegramApi.getUpdates", () => {
  it("posts offset/timeout/allowed_updates and returns the result array", async () => {
    const updates = [
      { update_id: 10, callback_query: { id: "q1", from: { id: 1 } } },
      { update_id: 11 },
    ];
    const { impl, calls } = fakeFetch(() => ({
      json: { ok: true, result: updates },
    }));
    const api = new TelegramApi(TOKEN, impl);
    const res = await api.getUpdates(10, 30);

    expect(calls[0].url).toBe(
      `https://api.telegram.org/bot${TOKEN}/getUpdates`
    );
    expect(calls[0].body.offset).toBe(10);
    expect(calls[0].body.timeout).toBe(30);
    expect(calls[0].body.allowed_updates).toEqual(["callback_query"]);
    expect(res).toEqual(updates);
  });
});

describe("TelegramApi.answerCallbackQuery", () => {
  it("posts the callback_query_id and optional text", async () => {
    const { impl, calls } = fakeFetch(() => ({
      json: { ok: true, result: true },
    }));
    const api = new TelegramApi(TOKEN, impl);
    await api.answerCallbackQuery("cbq-1", "Approved");
    expect(calls[0].url).toBe(
      `https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`
    );
    expect(calls[0].body.callback_query_id).toBe("cbq-1");
    expect(calls[0].body.text).toBe("Approved");
  });

  it("works without text", async () => {
    const { impl, calls } = fakeFetch(() => ({
      json: { ok: true, result: true },
    }));
    const api = new TelegramApi(TOKEN, impl);
    await api.answerCallbackQuery("cbq-2");
    expect(calls[0].body.callback_query_id).toBe("cbq-2");
  });
});

describe("TelegramApi error handling", () => {
  it("throws on {ok:false} including the Telegram description", async () => {
    const { impl } = fakeFetch(() => ({
      json: { ok: false, description: "Bad Request: chat not found" },
    }));
    const api = new TelegramApi(TOKEN, impl);
    await expect(api.sendMessage("x", "y")).rejects.toThrow(
      /chat not found/
    );
  });

  it("throws on HTTP non-2xx", async () => {
    const { impl } = fakeFetch(() => ({
      status: 500,
      json: { ok: false, description: "Internal Server Error" },
    }));
    const api = new TelegramApi(TOKEN, impl);
    await expect(api.getUpdates(0, 1)).rejects.toThrow();
  });

  // SECURITY: the bot token must never appear in a thrown error message.
  it("never leaks the token in a thrown error (ok:false)", async () => {
    const { impl } = fakeFetch(() => ({
      json: { ok: false, description: "Unauthorized" },
    }));
    const api = new TelegramApi(TOKEN, impl);
    let caught: Error | undefined;
    try {
      await api.sendMessage("x", "y");
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).not.toContain(TOKEN);
    expect(caught!.message).not.toContain("SECRET");
  });

  it("never leaks the token in a thrown error (HTTP non-2xx)", async () => {
    const { impl } = fakeFetch(() => ({
      status: 403,
      json: { ok: false, description: "Forbidden" },
    }));
    const api = new TelegramApi(TOKEN, impl);
    let caught: Error | undefined;
    try {
      await api.editMessageText("x", 1, "y");
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).not.toContain(TOKEN);
  });
});
