import { describe, it, expect, beforeEach } from "vitest";
import { CostTracker } from "../../src/cost/tracker.js";

describe("CostTracker", () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  it("records spend for an instance", () => {
    tracker.record({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      tool: "gpt-4o",
      cost: 0.50,
      timestamp: new Date(),
    });
    expect(tracker.getInstanceSpend("openclaw/session-a")).toBeCloseTo(0.50);
  });

  it("sums spend across instances of the same type", () => {
    const now = new Date();
    tracker.record({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      tool: "x",
      cost: 1.00,
      timestamp: now,
    });
    tracker.record({
      agentType: "openclaw",
      instanceId: "openclaw/session-b",
      tool: "x",
      cost: 2.00,
      timestamp: now,
    });
    expect(tracker.getTypeSpend("openclaw")).toBeCloseTo(3.00);
  });

  it("calculates daily spend for an agent type", () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 25 * 60 * 60 * 1000);
    tracker.record({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      tool: "x",
      cost: 5.00,
      timestamp: today,
    });
    tracker.record({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      tool: "x",
      cost: 10.00,
      timestamp: yesterday,
    });
    expect(tracker.getDailySpend("openclaw")).toBeCloseTo(5.00);
  });

  it("returns zero for instance with no spend", () => {
    expect(tracker.getInstanceSpend("nonexistent")).toBe(0);
  });

  it("write-through persists result tokens; hydration does not re-persist", () => {
    const persisted: unknown[] = [];
    const t = new CostTracker({ resultTokens: (r) => persisted.push(r) });
    t.recordResultTokens("openclaw", "i1", 100);
    expect(persisted).toHaveLength(1);

    t.hydrateResultTokens([{ agentType: "openclaw", instanceId: "i1", tokens: 50, timestamp: new Date() }]);
    expect(persisted).toHaveLength(1); // hydration must not write back
    expect(t.resultTokensSince("openclaw", new Date(0))).toBe(150);
  });

  it("hydrateSpend restores call counts and spend across restarts", () => {
    const t = new CostTracker();
    t.hydrateSpend([
      { agentType: "openclaw", instanceId: "i1", tool: "x", cost: 2, timestamp: new Date() },
      { agentType: "openclaw", instanceId: "i1", tool: "y", cost: 0, timestamp: new Date() },
    ]);
    expect(t.countCallsSince("openclaw", new Date(0))).toBe(2);
    expect(t.getDailySpend("openclaw")).toBeCloseTo(2);
  });
});
