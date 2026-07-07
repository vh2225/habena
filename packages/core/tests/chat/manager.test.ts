// packages/core/tests/chat/manager.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { ChatChannelManager } from "../../src/chat/manager.js";
import type { AgentBridge, BridgeEvent, ChatEvent } from "../../src/chat/types.js";

/** Hand-cranked bridge double: tests drive replies via emit(). */
class StubBridge implements AgentBridge {
  readonly kind = "stub";
  up = true;
  sent: string[] = [];
  private cbs = new Set<(ev: BridgeEvent) => void>();
  async start() {}
  async stop() {}
  isUp() { return this.up; }
  onEvent(cb: (ev: BridgeEvent) => void) { this.cbs.add(cb); return () => this.cbs.delete(cb); }
  emit(ev: BridgeEvent) { for (const cb of this.cbs) cb(ev); }
  async send(text: string) { this.sent.push(text); this.emit({ kind: "run_state", state: "started" }); }
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
});
