// packages/core/tests/chat/manager.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { ChatChannelManager } from "../../src/chat/manager.js";
import type { AgentBridge, BridgeEvent, ChatEvent } from "../../src/chat/types.js";

/** Hand-cranked bridge double: tests drive replies via emit(). */
class StubBridge implements AgentBridge {
  readonly kind = "stub";
  up = true;
  failNext = false;
  sent: string[] = [];
  private cbs = new Set<(ev: BridgeEvent) => void>();
  async start() {}
  async stop() {}
  isUp() { return this.up; }
  onEvent(cb: (ev: BridgeEvent) => void) { this.cbs.add(cb); return () => this.cbs.delete(cb); }
  emit(ev: BridgeEvent) { for (const cb of this.cbs) cb(ev); }
  async send(text: string) { if (this.failNext) { this.failNext = false; throw new Error("boom"); } this.sent.push(text); this.emit({ kind: "run_state", state: "started" }); }
}

let bridge: StubBridge;
let events: ChatEvent[];
let audits: any[];
let mgr: ChatChannelManager;

beforeEach(() => {
  bridge = new StubBridge();
  events = [];
  audits = [];
  mgr = new ChatChannelManager({
    bridge,
    limits: { telegram: { limit: 2, windowMs: 600_000 } },
    onAudit: (e) => audits.push(e),
    now: () => new Date("2026-07-05T00:00:00Z"),
  });
  mgr.subscribe((e) => events.push(e));
});

const finish = () => { bridge.emit({ kind: "final", text: "done" }); bridge.emit({ kind: "run_state", state: "finished" }); };

describe("ChatChannelManager", () => {
  it("accepts a web message, forwards to bridge, streams reply, returns to idle", () => {
    const res = mgr.handleInbound({ channel: "web", sender: "local", text: "hi" });
    expect(res.accepted).toBe(true);
    expect(bridge.sent).toEqual(["hi"]);
    expect(mgr.activeChannel()).toBe("web");
    bridge.emit({ kind: "delta", text: "do" });
    finish();
    expect(mgr.activeChannel()).toBeNull();
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("user");
    expect(kinds).toContain("assistant_delta");
    expect(kinds).toContain("assistant_final");
    expect(audits).toEqual([{ channel: "web", sender: "local", text: "hi", accepted: true }]);
  });

  it("queues while running, then dispatches FIFO with correct active channel", () => {
    mgr.handleInbound({ channel: "web", sender: "local", text: "first" });
    const res2 = mgr.handleInbound({ channel: "telegram", sender: "42", text: "second" });
    expect(res2.accepted).toBe(true);
    expect(bridge.sent).toEqual(["first"]); // second waits
    finish();
    expect(bridge.sent).toEqual(["first", "second"]);
    expect(mgr.activeChannel()).toBe("telegram");
  });

  it("trips the telegram breaker and rejects until rearm", () => {
    mgr.handleInbound({ channel: "telegram", sender: "42", text: "1" }); finish();
    mgr.handleInbound({ channel: "telegram", sender: "42", text: "2" }); finish();
    const res = mgr.handleInbound({ channel: "telegram", sender: "42", text: "3" });
    expect(res).toEqual({ accepted: false, reason: "rate_limited" });
    expect(mgr.status().disarmed).toEqual(["telegram"]);
    expect(events.some((e) => e.kind === "rejected")).toBe(true);
    // web is unaffected
    expect(mgr.handleInbound({ channel: "web", sender: "local", text: "ok" }).accepted).toBe(true);
    finish();
    mgr.rearm("telegram");
    expect(mgr.handleInbound({ channel: "telegram", sender: "42", text: "4" }).accepted).toBe(true);
  });

  it("rejects when the bridge is down", () => {
    bridge.up = false;
    expect(mgr.handleInbound({ channel: "web", sender: "local", text: "hi" }))
      .toEqual({ accepted: false, reason: "offline" });
    expect(audits.at(-1)).toMatchObject({ accepted: false, reason: "offline" });
  });

  it("bounds history and rejects when the queue is full", () => {
    const small = new ChatChannelManager({ bridge, historySize: 3, queueDepth: 1 });
    small.handleInbound({ channel: "web", sender: "local", text: "a" }); // running
    expect(small.handleInbound({ channel: "web", sender: "local", text: "b" }).accepted).toBe(true); // queued
    expect(small.handleInbound({ channel: "web", sender: "local", text: "c" }))
      .toEqual({ accepted: false, reason: "busy" });
    expect(small.history().length).toBeLessThanOrEqual(3);
  });

  it("continues draining after a failed send", async () => {
    bridge.failNext = true;
    mgr.handleInbound({ channel: "web", sender: "local", text: "M1" }); // active; send will throw async
    mgr.handleInbound({ channel: "web", sender: "local", text: "M2" }); // queued behind M1
    await new Promise((r) => setTimeout(r, 0));
    expect(events.some((e) => e.kind === "rejected" && e.channel === "web" && e.reason === "send_failed")).toBe(true);
    expect(audits.some((a) => a.accepted === false && a.reason === "send_failed" && a.text === "M1")).toBe(true);
    expect(bridge.sent).toContain("M2");
    expect(mgr.activeChannel()).toBe("web"); // M2 running
  });

  it("offline rejections do not consume rate-limit quota", () => {
    const b = new StubBridge();
    b.up = false;
    const m = new ChatChannelManager({
      bridge: b,
      limits: { telegram: { limit: 1, windowMs: 600_000 } },
      now: () => new Date("2026-07-05T00:00:00Z"),
    });
    expect(m.handleInbound({ channel: "telegram", sender: "42", text: "a" }))
      .toEqual({ accepted: false, reason: "offline" });
    expect(m.handleInbound({ channel: "telegram", sender: "42", text: "b" }))
      .toEqual({ accepted: false, reason: "offline" });
    expect(m.status().disarmed).toEqual([]);
    b.up = true;
    expect(m.handleInbound({ channel: "telegram", sender: "42", text: "c" }).accepted).toBe(true);
  });

  it("connection down flushes queued messages fail-closed", () => {
    mgr.handleInbound({ channel: "web", sender: "local", text: "M1" }); // running
    mgr.handleInbound({ channel: "web", sender: "local", text: "M2" }); // queued
    bridge.emit({ kind: "connection", state: "down" });
    expect(events.some((e) => e.kind === "rejected" && e.reason === "offline")).toBe(true);
    expect(audits.at(-1)).toMatchObject({ accepted: false, reason: "offline", text: "M2" });
    expect(mgr.activeChannel()).toBeNull();
    expect(mgr.status().queueDepth).toBe(0);
  });
});
