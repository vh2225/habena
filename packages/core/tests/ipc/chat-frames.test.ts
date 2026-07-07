import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { ApprovalQueue } from "../../src/approval/queue.js";
import { IpcServer } from "../../src/ipc/server.js";
import { encode, decodeLines, type ServerMessage } from "../../src/ipc/protocol.js";
import type { ChatEvent, ChatChannelId, InboundChatMessage } from "../../src/chat/types.js";

async function collectMessages(socket: Socket, n: number, timeoutMs = 2000): Promise<ServerMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: ServerMessage[] = [];
    let buffer = "";
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${n} messages, got ${messages.length}`)), timeoutMs);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const { messages: parsed, remainder } = decodeLines(buffer);
      buffer = remainder;
      for (const msg of parsed) {
        messages.push(msg as ServerMessage);
        if (messages.length >= n) {
          clearTimeout(timer);
          socket.off("data", onData);
          resolve(messages);
          return;
        }
      }
    };
    socket.on("data", onData);
  });
}

/** Minimal stand-in for ChatChannelManager (same spirit as StubBridge in Task 6). */
class StubChatManager {
  public readonly inbound: InboundChatMessage[] = [];
  public readonly rearmed: ChatChannelId[] = [];
  private subs = new Set<(ev: ChatEvent) => void>();

  get subscriberCount(): number {
    return this.subs.size;
  }

  subscribe(cb: (ev: ChatEvent) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  emit(ev: ChatEvent): void {
    for (const cb of this.subs) cb(ev);
  }

  handleInbound(msg: InboundChatMessage): { accepted: boolean; reason?: string } {
    this.inbound.push(msg);
    return { accepted: true };
  }

  history(limit?: number): ChatEvent[] {
    const all: ChatEvent[] = [{ kind: "assistant_final", text: "hist", at: "2026-01-01T00:00:00.000Z" }];
    return limit ? all.slice(-limit) : all;
  }

  status(): { bridgeUp: boolean; running: boolean; disarmed: ChatChannelId[]; queueDepth: number } {
    return { bridgeUp: true, running: false, disarmed: ["telegram"], queueDepth: 0 };
  }

  rearm(channel: ChatChannelId): void {
    this.rearmed.push(channel);
  }
}

describe("IPC chat frames", () => {
  let dir: string;
  let socketPath: string;
  let queue: ApprovalQueue;
  let chat: StubChatManager;
  let server: IpcServer;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-ipc-chat-"));
    socketPath = join(dir, "agentguard.sock");
    queue = new ApprovalQueue();
    chat = new StubChatManager();
    server = new IpcServer(queue, socketPath, undefined, chat as any);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    queue.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("chat_send routes to the manager as channel web and acks", async () => {
    const socket = createConnection(socketPath);
    await collectMessages(socket, 1); // hello
    socket.write(encode({ type: "chat_send", text: "hi" }));
    const [ack] = await collectMessages(socket, 1);
    expect(ack).toEqual({ type: "chat_ack", ok: true });
    expect(chat.inbound).toEqual([{ channel: "web", sender: "local", text: "hi" }]);
    socket.end();
  });

  it("chat_subscribe streams manager events and unsubscribes on disconnect", async () => {
    const socket = createConnection(socketPath);
    await collectMessages(socket, 1); // hello
    socket.write(encode({ type: "chat_subscribe" }));
    // give the server a tick to register the subscription
    await new Promise((r) => setTimeout(r, 20));
    expect(chat.subscriberCount).toBe(1);

    const ev: ChatEvent = { kind: "assistant_delta", text: "chunk", at: "2026-01-01T00:00:00.000Z" };
    chat.emit(ev);
    const [msg] = await collectMessages(socket, 1);
    expect(msg).toEqual({ type: "chat_event", event: ev });

    socket.end();
    await new Promise((r) => setTimeout(r, 20));
    expect(chat.subscriberCount).toBe(0);

    // emitting again after disconnect must not throw / must not resurrect a subscriber
    chat.emit(ev);
    expect(chat.subscriberCount).toBe(0);
  });

  it("double chat_subscribe on one socket delivers each event once and leaves no leak on close", async () => {
    const socket = createConnection(socketPath);
    await collectMessages(socket, 1); // hello

    socket.write(encode({ type: "chat_subscribe" }));
    socket.write(encode({ type: "chat_subscribe" }));
    await new Promise((r) => setTimeout(r, 20));
    // the guard replaces the first subscription instead of stacking a second
    expect(chat.subscriberCount).toBe(1);

    const ev: ChatEvent = { kind: "assistant_delta", text: "once", at: "2026-01-01T00:00:00.000Z" };
    chat.emit(ev);
    // exactly ONE chat_event arrives — a second copy would resolve this early
    const [first] = await collectMessages(socket, 1);
    expect(first).toEqual({ type: "chat_event", event: ev });
    await expect(collectMessages(socket, 1, 150)).rejects.toThrow(/timeout/);

    socket.end();
    await new Promise((r) => setTimeout(r, 20));
    expect(chat.subscriberCount).toBe(0);
  });

  it("chat_history / chat_status / chat_rearm map to manager methods", async () => {
    const socket = createConnection(socketPath);
    await collectMessages(socket, 1); // hello

    socket.write(encode({ type: "chat_history", limit: 5 }));
    const [historyMsg] = await collectMessages(socket, 1);
    expect(historyMsg).toEqual({
      type: "chat_history_result",
      events: [{ kind: "assistant_final", text: "hist", at: "2026-01-01T00:00:00.000Z" }],
    });

    socket.write(encode({ type: "chat_status" }));
    const [statusMsg] = await collectMessages(socket, 1);
    expect(statusMsg).toEqual({
      type: "chat_status_result",
      bridgeUp: true,
      running: false,
      disarmed: ["telegram"],
      queueDepth: 0,
    });

    socket.write(encode({ type: "chat_rearm", channel: "telegram" }));
    const [rearmAck] = await collectMessages(socket, 1);
    expect(rearmAck).toEqual({ type: "chat_ack", ok: true });
    expect(chat.rearmed).toEqual(["telegram"]);

    socket.end();
  });

  it("all chat frames error cleanly when chat is disabled", async () => {
    const bareSocketPath = join(dir, "bare.sock");
    const bareServer = new IpcServer(queue, bareSocketPath);
    await bareServer.start();
    const socket = createConnection(bareSocketPath);
    await collectMessages(socket, 1); // hello

    const frames: unknown[] = [
      { type: "chat_send", text: "hi" },
      { type: "chat_subscribe" },
      { type: "chat_history" },
      { type: "chat_status" },
      { type: "chat_rearm", channel: "web" },
    ];
    for (const frame of frames) {
      socket.write(encode(frame as any));
      const [err] = await collectMessages(socket, 1);
      expect(err).toEqual({ type: "error", message: "chat disabled" });
    }

    socket.end();
    await bareServer.stop();
  });
});
