import { describe, it, expect, vi } from "vitest";
import { PassThrough, type Duplex } from "node:stream";
import { chatSend, chatHistory, chatStatus, chatRearm, chatSubscribe } from "./chat-ipc";
import { encode, decodeLines, type ChatEventWire, type ClientMessage } from "./approval-protocol";

/**
 * A fake "proxy" that pipes client->server->client over two PassThroughs,
 * mirroring approval-ipc.test.ts's fakeProxy harness.
 */
function fakeProxy(handle: (msg: ClientMessage, toClient: PassThrough) => void): {
  connect: () => Duplex;
  toServerEnded: () => boolean;
} {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  let serverEnded = false;
  toServer.on("end", () => {
    serverEnded = true;
  });
  toClient.write(encode({ type: "hello", version: "test" }));
  let buf = "";
  toServer.on("data", (chunk) => {
    buf += chunk.toString();
    const { messages, remainder } = decodeLines(buf);
    buf = remainder;
    for (const m of messages as ClientMessage[]) {
      handle(m, toClient);
    }
  });
  const connect = () => {
    const conn = Object.create(toClient) as PassThrough;
    conn.write = toServer.write.bind(toServer) as PassThrough["write"];
    conn.end = (() => {
      toServer.end();
      toClient.end();
      return conn;
    }) as PassThrough["end"];
    return conn as unknown as Duplex;
  };
  return { connect, toServerEnded: () => serverEnded };
}

const EVT_1: ChatEventWire = { kind: "user", channel: "web", text: "hi", at: "2026-07-05T00:00:00.000Z" };
const EVT_2: ChatEventWire = { kind: "assistant_final", text: "hello back", at: "2026-07-05T00:00:01.000Z" };

describe("chat-ipc", () => {
  it("chatSend resolves ok on the happy path and ignores hello", async () => {
    const { connect } = fakeProxy((msg, toClient) => {
      if (msg.type === "chat_send") {
        toClient.write(encode({ type: "chat_ack", ok: true }));
      }
    });
    const result = await chatSend("hello", { connect });
    expect(result).toEqual({ ok: true });
  });

  it("chatSend rejects with a typed error when the proxy is down", async () => {
    const refused = () => {
      const conn = new PassThrough() as unknown as Duplex;
      // Simulate an immediate connection-refused error, mirroring a down proxy.
      queueMicrotask(() => {
        (conn as unknown as PassThrough).emit("error", new Error("connect ECONNREFUSED"));
      });
      return conn;
    };
    await expect(chatSend("hello", { connect: refused })).rejects.toThrow(/ECONNREFUSED/);
  });

  it("chatSend rejects on timeout when the server never answers", async () => {
    const silent = () => new PassThrough() as unknown as Duplex;
    await expect(chatSend("hello", { connect: silent, timeoutMs: 50 })).rejects.toThrow(/timed out/i);
  });

  it("a server error reply surfaces as a rejected promise with that message", async () => {
    const { connect } = fakeProxy((msg, toClient) => {
      if (msg.type === "chat_send") {
        toClient.write(encode({ type: "error", message: "chat disabled" }));
      }
    });
    await expect(chatSend("hello", { connect })).rejects.toThrow(/chat disabled/);
  });

  it("chatHistory returns the events array", async () => {
    const { connect } = fakeProxy((msg, toClient) => {
      if (msg.type === "chat_history") {
        toClient.write(encode({ type: "chat_history_result", events: [EVT_1, EVT_2] }));
      }
    });
    const got = await chatHistory(50, { connect });
    expect(got).toEqual([EVT_1, EVT_2]);
  });

  it("chatStatus returns the status fields", async () => {
    const { connect } = fakeProxy((msg, toClient) => {
      if (msg.type === "chat_status") {
        toClient.write(
          encode({ type: "chat_status_result", bridgeUp: true, running: false, disarmed: ["telegram"], queueDepth: 0 })
        );
      }
    });
    const got = await chatStatus({ connect });
    expect(got).toEqual({ bridgeUp: true, running: false, disarmed: ["telegram"], queueDepth: 0 });
  });

  it("chatRearm returns ok", async () => {
    const { connect } = fakeProxy((msg, toClient) => {
      if (msg.type === "chat_rearm") {
        toClient.write(encode({ type: "chat_ack", ok: true }));
      }
    });
    const got = await chatRearm("telegram", { connect });
    expect(got).toEqual({ ok: true });
  });

  it("chatSubscribe forwards chat_event frames and close() ends the connection", async () => {
    const { connect, toServerEnded } = fakeProxy((msg, toClient) => {
      if (msg.type === "chat_subscribe") {
        toClient.write(encode({ type: "chat_event", event: EVT_1 }));
        toClient.write(encode({ type: "chat_event", event: EVT_2 }));
      }
    });
    const received: ChatEventWire[] = [];
    const onError = vi.fn();
    const close = chatSubscribe((ev) => received.push(ev), onError, { connect });

    await vi.waitFor(() => expect(received).toEqual([EVT_1, EVT_2]));
    expect(onError).not.toHaveBeenCalled();

    close();
    await vi.waitFor(() => expect(toServerEnded()).toBe(true));
    expect(onError).not.toHaveBeenCalled();
  });

  it("chatSubscribe routes socket errors to onError", async () => {
    const conn = new PassThrough() as unknown as Duplex;
    const onEvent = vi.fn();
    const onError = vi.fn();
    chatSubscribe(onEvent, onError, { connect: () => conn });
    (conn as unknown as PassThrough).emit("error", new Error("socket blew up"));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0][0].message).toMatch(/socket blew up/);
    expect(onEvent).not.toHaveBeenCalled();
  });
});
