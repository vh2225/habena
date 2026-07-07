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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    await sleep(100);
    expect(bridge.isUp()).toBe(false);
    expect(gw.received.filter((r) => r.method === "connect").length).toBe(1);
  });

  it("terminates its socket after an auth rejection even if the gateway keeps it open", async () => {
    // keepOpenOnReject: the fake sends res ok:false but does NOT close the
    // connection server-side — the client must tear the socket down itself
    // or it stays orphaned forever.
    gw = new FakeGateway({ requireToken: "tok", keepOpenOnReject: true });
    await gw.start();
    bridge = new OpenClawBridge({ url: gw.url, token: "WRONG", sessionKey: "s", backoffMs: [10] });
    await expect(bridge.start()).rejects.toThrow(/unauthorized/i);
    expect(bridge.isUp()).toBe(false);
    // The fake sees the connection close only if the CLIENT terminates it.
    await until(() => gw.openConnections === 0);
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

  it("filters chat events by runId while a run is ACTIVE, ignoring background noise", async () => {
    // holdReplies: the fake acks chat.send (activating the run) but holds the
    // streamed reply until flushReply(), so the noise below is injected while
    // the run is active — proving filtering happens by runId mismatch, not by
    // the no-active-run short-circuit.
    gw = new FakeGateway({ requireToken: "tok", holdReplies: true });
    await gw.start();
    gw.replyWith(["Hi ", "there"], "Hi there");
    bridge = new OpenClawBridge({ url: gw.url, token: "tok", sessionKey: "habena-chat" });
    const events: BridgeEvent[] = [];
    bridge.onEvent((e) => events.push(e));
    await bridge.start();

    await bridge.send("hello");
    // Wait until the fake has received chat.send — its ack is then already on
    // the wire, so the same-socket ordering guarantees the bridge processes
    // the ack (activating the run) BEFORE the noise frames emitted below.
    await until(() => gw.received.some((r) => r.method === "chat.send"));

    // Background noise: an unrelated run's chat events sharing the socket
    // (fixtures/README.md "Filter by runId" — active-memory-* jobs and
    // ambient events interleave with the real reply on the live gateway).
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
    // Now release the real (held) reply.
    gw.flushReply();

    await until(() => events.some((e) => e.kind === "final"));
    expect(events.some((e) => e.kind === "delta" && (e as any).text === "IGNORE ME")).toBe(false);
    expect(events.filter((e) => e.kind === "final")).toHaveLength(1);
    expect(events.find((e) => e.kind === "final")).toMatchObject({ text: "Hi there" });
    expect(events.filter((e) => e.kind === "run_state" && (e as any).state === "finished")).toHaveLength(1);
  });

  it("maps chat state:error to a run_state error event, still filtered by runId", async () => {
    gw = new FakeGateway({ requireToken: "tok", holdReplies: true });
    await gw.start();
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
    // Real error for our run (the held reply is never flushed).
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

  it("stop() then start() does not leak the old socket's teardown into the new connection", async () => {
    gw = new FakeGateway();
    await gw.start();
    bridge = new OpenClawBridge({ url: gw.url, sessionKey: "s", backoffMs: [50, 50] });
    const events: BridgeEvent[] = [];
    bridge.onEvent((e) => events.push(e));
    await bridge.start();
    await bridge.stop();
    await bridge.start();
    expect(bridge.isUp()).toBe(true);

    // Give a rogue reconnect timer (the bug: the old socket's close scheduling
    // a reconnect against the new generation) several backoff ticks to fire.
    await sleep(300);
    expect(bridge.isUp()).toBe(true);
    // Exactly one down (the deliberate stop()); no spurious down from the old
    // socket's close landing after the new hello-ok.
    expect(events.filter((e) => e.kind === "connection" && (e as any).state === "down")).toHaveLength(1);
    // Exactly two connects (one per start()); no duplicate-socket storm.
    expect(gw.received.filter((r) => r.method === "connect")).toHaveLength(2);
  });

  it("start() while a reconnect timer is pending cancels it instead of racing it", async () => {
    gw = new FakeGateway();
    const port = await gw.start();
    bridge = new OpenClawBridge({ url: gw.url, sessionKey: "s", backoffMs: [200, 200] });
    const events: BridgeEvent[] = [];
    bridge.onEvent((e) => events.push(e));
    await bridge.start();
    await gw.stop();
    await until(() => events.some((e) => e.kind === "connection" && (e as any).state === "down"));
    // A reconnect timer is now armed (~200ms). Revive the gateway and call
    // start() before it fires.
    gw = new FakeGateway();
    await gw.start(port);
    await bridge.start();
    expect(bridge.isUp()).toBe(true);

    // Wait past the pending timer's deadline: if it wasn't cancelled it would
    // open a second socket and send a second connect req.
    await sleep(400);
    expect(bridge.isUp()).toBe(true);
    expect(gw.received.filter((r) => r.method === "connect")).toHaveLength(1);
  });

  it("start() rejects after connectTimeoutMs when the gateway accepts the socket but never responds", async () => {
    gw = new FakeGateway({ silent: true });
    await gw.start();
    bridge = new OpenClawBridge({ url: gw.url, sessionKey: "s", connectTimeoutMs: 100, backoffMs: [50] });
    const events: BridgeEvent[] = [];
    bridge.onEvent((e) => events.push(e));
    await expect(bridge.start()).rejects.toThrow(/timed out/i);
    expect(bridge.isUp()).toBe(false);

    // A gateway that stays silent forever must never come up, no matter how
    // many background reconnect attempts fire against it (see the dedicated
    // retry-and-recover test below for what happens once it responds).
    await sleep(200);
    expect(bridge.isUp()).toBe(false);
    expect(events.some((e) => e.kind === "connection" && (e as any).state === "up")).toBe(false);
  });

  it("retries after a boot-time handshake timeout and reconnects once the gateway responds, without a new start() call", async () => {
    gw = new FakeGateway({ silent: true });
    const port = await gw.start();
    bridge = new OpenClawBridge({ url: gw.url, sessionKey: "s", connectTimeoutMs: 80, backoffMs: [40, 40, 40] });
    const events: BridgeEvent[] = [];
    bridge.onEvent((e) => events.push(e));

    // Boot-time handshake hang: the gateway accepts the TCP socket but never
    // completes the hello — start() must reject on the connect timeout...
    await expect(bridge.start()).rejects.toThrow(/timed out/i);
    expect(bridge.isUp()).toBe(false);

    // ...but (the fix) it must ALSO have armed a background reconnect, the
    // same as the ECONNREFUSED-at-boot path via onDown. Revive the gateway
    // (now responsive) on the same port before the retry fires.
    await gw.stop();
    gw = new FakeGateway();
    await gw.start(port);

    // No second start() call anywhere below: recovery must come from the
    // bridge's own background retry loop.
    await until(() => bridge.isUp(), 3000);
  });
});
