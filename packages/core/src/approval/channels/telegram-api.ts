/**
 * Thin Telegram Bot API client. No queue/channel logic — just the four HTTP
 * methods D3 needs, behind an injectable `fetch` so it's fully unit-testable.
 *
 * SECURITY: the bot token is a secret. It is interpolated ONLY into the request
 * URL and never logged, never placed in an error message, and never returned.
 * There is intentionally no console logging in this client.
 */

export interface TelegramUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    from: { id: number };
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

interface InlineButton {
  text: string;
  callback_data: string;
}
type InlineKeyboard = Array<Array<InlineButton>>;

/** Shape of a Telegram Bot API JSON envelope. */
interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export class TelegramApi {
  private readonly baseUrl: string;

  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  /**
   * POST to a Telegram method and unwrap the envelope. Throws on HTTP non-2xx
   * or `{ok:false}`, surfacing the Telegram `description` but NEVER the token.
   */
  private async call<T>(method: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    let envelope: TelegramEnvelope<T> | undefined;
    try {
      envelope = (await res.json()) as TelegramEnvelope<T>;
    } catch {
      envelope = undefined;
    }

    if (!res.ok || !envelope || envelope.ok === false) {
      // Only the (token-free) method name and Telegram description are
      // exposed — the URL/token is deliberately excluded.
      const desc = envelope?.description ?? `HTTP ${res.status}`;
      throw new Error(`Telegram ${method} failed: ${desc}`);
    }

    return envelope.result as T;
  }

  async sendMessage(
    chatId: string | number,
    text: string,
    inlineKeyboard?: InlineKeyboard
  ): Promise<{ message_id: number }> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    };
    if (inlineKeyboard) {
      body.reply_markup = { inline_keyboard: inlineKeyboard };
    }
    return this.call<{ message_id: number }>("sendMessage", body);
  }

  async editMessageText(
    chatId: string | number,
    messageId: number,
    text: string
  ): Promise<void> {
    await this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  }

  async getUpdates(offset: number, timeoutSec: number): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>("getUpdates", {
      offset,
      timeout: timeoutSec,
      allowed_updates: ["callback_query"],
    });
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string
  ): Promise<void> {
    const body: Record<string, unknown> = {
      callback_query_id: callbackQueryId,
    };
    if (text !== undefined) body.text = text;
    await this.call("answerCallbackQuery", body);
  }
}
