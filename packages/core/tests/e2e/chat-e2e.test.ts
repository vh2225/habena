// packages/core/tests/e2e/chat-e2e.test.ts
// Full-stack chat wiring, in-process: FakeGateway -> OpenClawBridge ->
// ChatChannelManager -> real IpcServer on a temp unix socket, driven by a
// raw IPC client (no mocks below the gateway boundary). Mirrors the harness
// style of tests/e2e/approval-flow.test.ts (real components, temp dirs,
// real sockets) and reuses the Task 7 channel-floor pattern
// (tests/proxy/channel-floor.test.ts) for the policy-floor assertion.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FakeGateway } from "../chat/fake-gateway.js";
import { OpenClawBridge } from "../../src/chat/openclaw-bridge.js";
import { ChatChannelManager } from "../../src/chat/manager.js";
import { IpcServer } from "../../src/ipc/server.js";
import { encode, decodeLines, type ServerMessage } from "../../src/ipc/protocol.js";
import type { ChatEvent } from "../../src/chat/types.js";
import { ProxyDispatcher } from "../../src/proxy/server.js";
import { PolicyEngine } from "../../src/policy/engine.js";
import { getPreset } from "../../src/policy/presets.js";
import { CostTracker } from "../../src/cost/tracker.js";
import { BudgetEnforcer } from "../../src/cost/budget.js";
import { AuditLogger } from "../../src/audit/logger.js";
import { InstanceTracker } from "../../src/identity/instances.js";
import { ApprovalQueue } from "../../src/approval/queue.js";

async function collectMessages(socket: Socket, n: number, timeoutMs = 3000): Promise<ServerMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: ServerMessage[] = [];
    let buffer = "";
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for ${n} messages, got ${messages.length}: ${JSON.stringify(messages)}`)),
      timeoutMs,
    );
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

describe("chat E2E", () => {
  let dir: string;
  let socketPath: string;
  let gw: FakeGateway;
  let bridge: OpenClawBridge;
  let mgr: ChatChannelManager;
  let queue: ApprovalQueue;
  let ipc: IpcServer;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-chat-e2e-"));
    socketPath = join(dir, "agentguard.sock");

    gw = new FakeGateway({ requireToken: "tok" });
    await gw.start();

    bridge = new OpenClawBridge({ url: gw.url, token: "tok", sessionKey: "habena-chat" });
    await bridge.start();

    mgr = new ChatChannelManager({
      bridge,
      limits: { telegram: { limit: 2, windowMs: 600_000 } },
    });

    queue = new ApprovalQueue();
    ipc = new IpcServer(queue, socketPath, undefined, mgr);
    await ipc.start();
  });

  afterEach(async () => {
    await ipc.stop();
    queue.shutdown();
    await bridge.stop();
    await gw.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("web chat_send round-trips through bridge + manager + IPC as user/delta/final chat_events", async () => {
    gw.replyWith(["Hel", "lo!"], "Hello!");

    const socket = createConnection(socketPath);
    await collectMessages(socket, 1); // hello

    socket.write(encode({ type: "chat_subscribe" }));
    // Give the server a tick to register the subscription before we send,
    // so we don't race the manager's synchronous emit of the "user" event.
    await new Promise((r) => setTimeout(r, 20));

    // The manager emits the "user" chat_event SYNCHRONOUSLY inside
    // handleInbound(), before chat_send's handler writes the chat_ack — so
    // on the wire the first chat_event can arrive before the ack. Collect
    // everything (ack + events) together rather than assuming ack-first.
    socket.write(encode({ type: "chat_send", text: "hello" }));

    const frames: ServerMessage[] = [];
    const events: ChatEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout waiting for assistant_final, got ${JSON.stringify(frames)}`)),
        3000,
      );
      let buffer = "";
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        const { messages, remainder } = decodeLines(buffer);
        buffer = remainder;
        for (const msg of messages) {
          const m = msg as ServerMessage;
          frames.push(m);
          if (m.type === "chat_event") {
            events.push(m.event);
            if (m.event.kind === "assistant_final") {
              clearTimeout(timer);
              socket.off("data", onData);
              resolve();
            }
          }
        }
      };
      socket.on("data", onData);
    });

    expect(frames.find((m) => m.type === "chat_ack")).toEqual({ type: "chat_ack", ok: true });
    expect(events.find((e) => e.kind === "user")).toMatchObject({ kind: "user", channel: "web", text: "hello" });
    expect(events.filter((e) => e.kind === "assistant_delta").map((e: any) => e.text)).toEqual(["Hel", "lo!"]);
    expect(events.find((e) => e.kind === "assistant_final")).toMatchObject({ kind: "assistant_final", text: "Hello!" });

    socket.end();
  });

  it("telegram inbound breaker trips on the third message; chat_status reports disarmed; chat_rearm clears it", async () => {
    gw.replyWith(["ok"], "ok");

    const r1 = mgr.handleInbound({ channel: "telegram", sender: "42", text: "one" });
    const r2 = mgr.handleInbound({ channel: "telegram", sender: "42", text: "two" });
    const r3 = mgr.handleInbound({ channel: "telegram", sender: "42", text: "three" });
    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(true);
    expect(r3).toEqual({ accepted: false, reason: "rate_limited" });

    const socket = createConnection(socketPath);
    await collectMessages(socket, 1); // hello

    socket.write(encode({ type: "chat_status" }));
    const [status] = await collectMessages(socket, 1);
    expect(status).toMatchObject({ type: "chat_status_result", disarmed: ["telegram"] });

    socket.write(encode({ type: "chat_rearm", channel: "telegram" }));
    const [rearmAck] = await collectMessages(socket, 1);
    expect(rearmAck).toEqual({ type: "chat_ack", ok: true });

    socket.write(encode({ type: "chat_status" }));
    const [status2] = await collectMessages(socket, 1);
    expect(status2).toMatchObject({ type: "chat_status_result", disarmed: [] });

    socket.end();
  });

  it("channel floor: a telegram-originated run escalates a user-allowed write to require_approval, tagged origin telegram", async () => {
    // Task 7 harness pattern (tests/proxy/channel-floor.test.ts), wired to
    // the SAME manager instance driving this suite's real bridge, so
    // chatFloor.active() reflects the real activeChannel() set by drain().
    const audit = new AuditLogger(join(dir, "floor-audit.db"));
    const approval = new ApprovalQueue();
    const preset = getPreset("cautious");
    if (!preset) throw new Error("cautious preset missing");

    const dispatcher = new ProxyDispatcher({
      policy: new PolicyEngine([{ match: { tool: "write_file" }, action: "allow", reason: "user allows writes" }]),
      tracker: new CostTracker(),
      budget: new BudgetEnforcer(new CostTracker(), {}),
      audit,
      instances: new InstanceTracker(),
      approval,
      approvalTimeoutMs: 5000,
      chatFloor: { active: () => mgr.activeChannel(), engine: new PolicyEngine(preset.rules) },
    });

    gw.replyWith(["ok"], "ok");
    const inbound = mgr.handleInbound({ channel: "telegram", sender: "42", text: "delete the report" });
    expect(inbound.accepted).toBe(true);
    // drain() sets activeChannel() synchronously before the async gateway
    // round-trip even starts — no timing race needed here.
    expect(mgr.activeChannel()).toBe("telegram");

    const pendingPromise = dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "write_file",
      args: { path: "/tmp/report.txt" },
      estimatedCost: 0,
    });
    await new Promise((r) => setTimeout(r, 10));
    const pending = approval.list();
    expect(pending).toHaveLength(1);
    expect(pending[0].decision.action).toBe("require_approval");
    expect(pending[0].request.origin).toBe("telegram");

    approval.respond(pending[0].id, { choice: "allow_once" });
    const result = await pendingPromise;
    expect(result.decision.action).toBe("allow");

    approval.shutdown();
    audit.close();
  });
});
