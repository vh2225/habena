// packages/core/tests/chat/openclaw-bridge.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { FakeGateway } from "./fake-gateway.js";
import { OpenClawBridge } from "../../src/chat/openclaw-bridge.js";
import type { BridgeEvent } from "../../src/chat/types.js";

const until = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

let gw: FakeGateway;
let bridge: OpenClawBridge;
afterEach(async () => {
  await bridge?.stop();
  await gw?.stop();
});

describe("OpenClawBridge", () => {
  it("connects, sends, and streams deltas + final back as BridgeEvents", async () => {
    gw = new FakeGateway({ requireToken: "tok" });
    await gw.start();
    gw.replyWith(["Hi ", "there"], "Hi there");
    bridge = new OpenClawBridge({ url: gw.url, token: "tok", sessionKey: "habena-chat" });
    const events: BridgeEvent[] = [];
    bridge.onEvent((e) => events.push(e));
    await bridge.start();
    expect(bridge.isUp()).toBe(true);
    await bridge.send("hello");
    await until(() => events.some((e) => e.kind === "final"));
    expect(events.filter((e) => e.kind === "delta").map((e: any) => e.text)).toEqual(["Hi ", "there"]);
    expect(events.find((e) => e.kind === "final")).toMatchObject({ text: "Hi there" });
    expect(events.some((e) => e.kind === "run_state" && (e as any).state === "finished")).toBe(true);
    expect(events.some((e) => e.kind === "run_state" && (e as any).state === "started")).toBe(true);

    // Real dialect (tests/chat/fixtures/README.md "chat.send"): params carry
    // `message`, not `text`, plus a fresh idempotencyKey.
    const sent = gw.received.find((r) => r.method === "chat.send") as any;
    expect(sent.params.sessionKey).toBe("habena-chat");
    expect(sent.params.message).toBe("hello");
    expect(sent.params.idempotencyKey).toBeTruthy();

    // Real dialect (fixtures/README.md "Connect identity"): the loopback
    // backend carve-out, not an "operator"-mode client identity (which gets
    // its scopes cleared by the real gateway per the scope-fail fixture).
    const connectReq = gw.received.find((r) => r.method === "connect") as any;
    expect(connectReq.params.client).toMatchObject({ id: "gateway-client", mode: "backend" });
    expect(connectReq.params.role).toBe("operator");
    expect(connectReq.params.scopes).toEqual(["operator.read", "operator.write"]);
  });

  it("rejects start() on bad token without retry-looping", async () => {
    gw = new FakeGateway({ requireToken: "tok" });
    await gw.start();
    bridge = new OpenClawBridge({ url: gw.url, token: "WRONG", sessionKey: "s", backoffMs: [10] });
    await expect(bridge.start()).rejects.toThrow(/unauthorized/i);
    expect(bridge.isUp()).toBe(false);

    // No reconnect loop: give the 10ms backoff several chances to fire and
    // confirm the bridge never climbs back up or re-sends connect.
    await new Promise((r) => setTimeout(r, 100));
    expect(bridge.isUp()).toBe(false);
    expect(gw.received.filter((r) => r.method === "connect").length).toBe(1);
  });

  it("emits connection down and reconnects when the gateway drops", async () => {
    gw = new FakeGateway();
    const port = await gw.start();
    bridge = new OpenClawBridge({ url: gw.url, sessionKey: "s", backoffMs: [50, 50, 50] });
    const events: BridgeEvent[] = [];
    bridge.onEvent((e) => events.push(e));
    await bridge.start();
    await gw.stop();
    await until(() => events.some((e) => e.kind === "connection" && (e as any).state === "down"));
    gw = new FakeGateway();
    await gw.start(port); // revive on the same port (FakeGateway.start accepts a fixed port)
    // reconnect lands within a few backoff ticks
    await until(() => bridge.isUp(), 5000);
  });

  it("filters chat events by runId, ignoring background noise on the same socket", async () => {
    gw = new FakeGateway({ requireToken: "tok" });
    await gw.start();
    gw.replyWith(["Hi ", "there"], "Hi there");
    bridge = new OpenClawBridge({ url: gw.url, token: "tok", sessionKey: "habena-chat" });
    const events: BridgeEvent[] = [];
    bridge.onEvent((e) => events.push(e));
    await bridge.start();

    // Background noise: an unrelated run's chat event sharing the socket
    // (fixtures/README.md "Filter by runId" — active-memory-* jobs and
    // ambient events interleave with the real reply on the live gateway).
    // FakeGateway has no built-in way to script this, so this task adds a
    // minimal emitRaw() broadcast hook to the double.
    gw.emitRaw({
      type: "event",
      event: "chat",
      payload: {
        runId: "active-memory-noise-1",
        sessionKey: "habena-chat",
        seq: 99,
        state: "delta",
        deltaText: "IGNORE ME",
        message: { role: "assistant", content: [{ type: "text", text: "IGNORE ME" }], timestamp: 1 },
      },
    });
    gw.emitRaw({
      type: "event",
      event: "chat",
      payload: {
        runId: "active-memory-noise-1",
        sessionKey: "habena-chat",
        seq: 100,
        state: "final",
        stopReason: "stop",
        message: { role: "assistant", content: [{ type: "text", text: "IGNORE ME" }], timestamp: 1 },
      },
    });

    await bridge.send("hello");
    await until(() => events.some((e) => e.kind === "final"));

    expect(events.some((e) => e.kind === "delta" && (e as any).text === "IGNORE ME")).toBe(false);
    expect(events.filter((e) => e.kind === "final")).toHaveLength(1);
    expect(events.find((e) => e.kind === "final")).toMatchObject({ text: "Hi there" });
  });

  it("maps chat state:error to a run_state error event, still filtered by runId", async () => {
    gw = new FakeGateway({ requireToken: "tok" });
    await gw.start();
    gw.replyWith([], "unused");
    bridge = new OpenClawBridge({ url: gw.url, token: "tok", sessionKey: "habena-chat" });
    const events: BridgeEvent[] = [];
    bridge.onEvent((e) => events.push(e));
    await bridge.start();
    await bridge.send("hello");
    await until(() => gw.received.some((r) => r.method === "chat.send"));
    const runId = (gw.received.find((r) => r.method === "chat.send") as any).params.idempotencyKey;

    // Noise on a different runId must not surface as an error.
    gw.emitRaw({
      type: "event",
      event: "chat",
      payload: { runId: "other-run", sessionKey: "habena-chat", seq: 1, state: "error", errorMessage: "unrelated" },
    });
    // Real error for our run.
    gw.emitRaw({
      type: "event",
      event: "chat",
      payload: { runId, sessionKey: "habena-chat", seq: 2, state: "error", errorMessage: "boom" },
    });

    await until(() => events.some((e) => e.kind === "run_state" && (e as any).state === "error"));
    const errs = events.filter((e) => e.kind === "run_state" && (e as any).state === "error") as any[];
    expect(errs).toHaveLength(1);
    expect(errs[0].detail).toBe("boom");
  });
});
