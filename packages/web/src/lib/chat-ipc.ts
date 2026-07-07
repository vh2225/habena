import { createConnection } from "node:net";
import type { Duplex } from "node:stream";
import {
  encode,
  decodeLines,
  type ServerMessage,
  type ClientMessage,
  type ChatEventWire,
} from "./approval-protocol";
import { socketPath } from "./approval-ipc";

/** Injectable connector — default opens the real unix socket; tests pass a fake Duplex. */
export interface IpcOptions {
  connect?: () => Duplex;
  timeoutMs?: number;
}
function defaultConnect(): Duplex {
  return createConnection(socketPath()) as unknown as Duplex;
}

/**
 * Generic one-shot: send a request, resolve when `match` returns a value, then close.
 * Mirrors approval-ipc.ts's roundTrip, plus: an `{type:"error"}` server reply always
 * rejects (chat frames can be turned down server-side, e.g. "chat disabled").
 */
function roundTrip<T>(
  request: ClientMessage,
  match: (msg: ServerMessage) => T | undefined,
  opts: IpcOptions
): Promise<T> {
  const conn = (opts.connect ?? defaultConnect)();
  const timeoutMs = opts.timeoutMs ?? 2000;
  return new Promise<T>((resolve, reject) => {
    let buffer = "";
    const cleanup = () => {
      clearTimeout(timer);
      conn.removeAllListeners("data");
      conn.removeAllListeners("error");
      try { conn.end(); } catch { /* noop */ }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for proxy response"));
    }, timeoutMs);
    conn.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const { messages, remainder } = decodeLines(buffer);
      buffer = remainder;
      for (const raw of messages) {
        const msg = raw as ServerMessage;
        if (msg.type === "error") {
          cleanup();
          reject(new Error(msg.message));
          return;
        }
        const hit = match(msg);
        if (hit !== undefined) { cleanup(); resolve(hit); return; }
      }
    });
    conn.on("error", (err: Error) => { cleanup(); reject(err); });
    conn.write(encode(request));
  });
}

export async function chatSend(
  text: string,
  opts: IpcOptions = {}
): Promise<{ ok: boolean; reason?: string }> {
  return roundTrip(
    { type: "chat_send", text },
    (msg) => (msg.type === "chat_ack" ? { ok: msg.ok, reason: msg.reason } : undefined),
    opts
  );
}

export async function chatHistory(limit?: number, opts: IpcOptions = {}): Promise<ChatEventWire[]> {
  return roundTrip(
    { type: "chat_history", limit },
    (msg) => (msg.type === "chat_history_result" ? msg.events : undefined),
    opts
  );
}

export async function chatStatus(
  opts: IpcOptions = {}
): Promise<{ bridgeUp: boolean; running: boolean; disarmed: string[]; queueDepth: number }> {
  return roundTrip(
    { type: "chat_status" },
    (msg) =>
      msg.type === "chat_status_result"
        ? { bridgeUp: msg.bridgeUp, running: msg.running, disarmed: msg.disarmed, queueDepth: msg.queueDepth }
        : undefined,
    opts
  );
}

export async function chatRearm(
  channel: "web" | "telegram",
  opts: IpcOptions = {}
): Promise<{ ok: boolean }> {
  return roundTrip(
    { type: "chat_rearm", channel },
    (msg) => (msg.type === "chat_ack" ? { ok: msg.ok } : undefined),
    opts
  );
}

/**
 * Long-lived subscription: opens a connection, sends chat_subscribe, and forwards every
 * chat_event to `onEvent` until the returned closer is called. Socket errors/close (that
 * the caller didn't initiate) route to `onError`; server `{type:"error"}` frames do too.
 */
export function chatSubscribe(
  onEvent: (ev: ChatEventWire) => void,
  onError: (err: Error) => void,
  opts: IpcOptions = {}
): () => void {
  const conn = (opts.connect ?? defaultConnect)();
  let buffer = "";
  let closed = false;

  const detach = () => {
    conn.removeAllListeners("data");
    conn.removeAllListeners("error");
    conn.removeAllListeners("close");
  };

  conn.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const { messages, remainder } = decodeLines(buffer);
    buffer = remainder;
    for (const raw of messages) {
      const msg = raw as ServerMessage;
      if (msg.type === "chat_event") onEvent(msg.event);
      else if (msg.type === "error") onError(new Error(msg.message));
    }
  });
  conn.on("error", (err: Error) => {
    if (closed) return;
    onError(err);
  });
  conn.on("close", () => {
    if (closed) return;
    onError(new Error("Proxy connection closed"));
  });
  conn.write(encode({ type: "chat_subscribe" }));

  return () => {
    if (closed) return;
    closed = true;
    detach();
    try { conn.end(); } catch { /* noop */ }
  };
}
