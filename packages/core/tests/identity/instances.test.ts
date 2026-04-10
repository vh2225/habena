import { describe, it, expect, beforeEach } from "vitest";
import { InstanceTracker } from "../../src/identity/instances.js";

describe("InstanceTracker", () => {
  let tracker: InstanceTracker;

  beforeEach(() => {
    tracker = new InstanceTracker();
  });

  it("creates an instance with unique id", () => {
    const a = tracker.create("openclaw");
    const b = tracker.create("openclaw");
    expect(a.instanceId).not.toBe(b.instanceId);
  });

  it("instance id includes agent type", () => {
    const i = tracker.create("openclaw");
    expect(i.instanceId).toContain("openclaw/");
  });

  it("tracks spend per instance", () => {
    const i = tracker.create("openclaw");
    tracker.recordSpend(i.instanceId, 1.5);
    tracker.recordSpend(i.instanceId, 2.25);
    expect(tracker.get(i.instanceId)?.spend).toBeCloseTo(3.75);
  });

  it("increments call count on spend", () => {
    const i = tracker.create("openclaw");
    tracker.recordSpend(i.instanceId, 0);
    tracker.recordSpend(i.instanceId, 0);
    expect(tracker.get(i.instanceId)?.callCount).toBe(2);
  });

  it("lists instances by agent type", () => {
    tracker.create("openclaw");
    tracker.create("openclaw");
    tracker.create("research-bot");
    expect(tracker.listByType("openclaw")).toHaveLength(2);
    expect(tracker.listByType("research-bot")).toHaveLength(1);
  });

  it("counts running instances", () => {
    const a = tracker.create("openclaw");
    tracker.create("openclaw");
    tracker.stop(a.instanceId);
    expect(tracker.countRunning("openclaw")).toBe(1);
  });

  it("sums spend across all instances of a type", () => {
    const a = tracker.create("openclaw");
    const b = tracker.create("openclaw");
    tracker.recordSpend(a.instanceId, 10);
    tracker.recordSpend(b.instanceId, 5);
    expect(tracker.totalSpendByType("openclaw")).toBe(15);
  });
});
