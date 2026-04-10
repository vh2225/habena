import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { ApprovalQueue } from "../../src/approval/queue.js";
import { IpcServer } from "../../src/ipc/server.js";
import { encode, decodeLines, type ServerMessage } from "../../src/ipc/protocol.js";
import type { PolicyDecision } from "../../src/policy/decisions.js";
import type { ToolCallRequest } from "../../src/proxy/server.js";

function sampleDecision(): PolicyDecision {
  return {
    action: "require_approval",
    reason: "needs approval",
    tool: "gmail_send",
    enforcement: "soft_mandatory",
    risk_level: "medium",
    tier: "user",
  };
}

function sampleRequest(): ToolCallRequest {
  return {
    agentType: "openclaw",
    instanceId: "openclaw/test",
    tool: "gmail_send",
    args: { to: "x" },
    estimatedCost: 0,
  };
}

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

describe("IpcServer", () => {
  let dir: string;
  let socketPath: string;
  let queue: ApprovalQueue;
  let server: IpcServer;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-ipc-"));
    socketPath = join(dir, "agentguard.sock");
    queue = new ApprovalQueue();
    server = new IpcServer(queue, socketPath);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    queue.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a client and sends hello", async () => {
    const socket = createConnection(socketPath);
    const [hello] = await collectMessages(socket, 1);
    expect(hello.type).toBe("hello");
    socket.end();
  });

  it("broadcasts approval_request when queue emits", async () => {
    const socket = createConnection(socketPath);
    await collectMessages(socket, 1); // consume hello
    queue.request(sampleDecision(), sampleRequest(), 60000);
    const [msg] = await collectMessages(socket, 1);
    expect(msg.type).toBe("approval_request");
    if (msg.type === "approval_request") {
      expect(msg.pending.tool).toBe("gmail_send");
    }
    socket.end();
  });

  it("forwards client respond message to queue", async () => {
    const socket = createConnection(socketPath);
    await collectMessages(socket, 1);
    const promise = queue.request(sampleDecision(), sampleRequest(), 60000);
    const [req] = await collectMessages(socket, 1);
    if (req.type !== "approval_request") throw new Error("expected approval_request");
    socket.write(encode({ type: "respond", id: req.id, choice: "allow_once" }));
    const response = await promise;
    expect(response.choice).toBe("allow_once");
    socket.end();
  });

  it("sends pending_list on list_pending when there are existing pendings", async () => {
    const promise = queue.request(sampleDecision(), sampleRequest(), 60000);
    const socket = createConnection(socketPath);
    // On connect, the server sends hello + existing approval_request for any pending items
    const initial = await collectMessages(socket, 2);
    expect(initial[0].type).toBe("hello");
    expect(initial[1].type).toBe("approval_request");
    // Explicit list_pending still works
    socket.write(encode({ type: "list_pending" }));
    const [listMsg] = await collectMessages(socket, 1);
    expect(listMsg.type).toBe("pending_list");
    if (listMsg.type === "pending_list") {
      expect(listMsg.pending).toHaveLength(1);
    }
    // Clean up pending approval
    if (initial[1].type === "approval_request") {
      queue.respond(initial[1].id, { choice: "deny" });
    }
    await promise;
    socket.end();
  });

  it("cleans up stale socket file on start", async () => {
    await server.stop();
    // leave a fake stale file
    const { writeFileSync } = await import("node:fs");
    writeFileSync(socketPath, "stale");
    const newQueue = new ApprovalQueue();
    const newServer = new IpcServer(newQueue, socketPath);
    await newServer.start();
    const socket = createConnection(socketPath);
    const [hello] = await collectMessages(socket, 1);
    expect(hello.type).toBe("hello");
    socket.end();
    await newServer.stop();
    newQueue.shutdown();
  });
});
