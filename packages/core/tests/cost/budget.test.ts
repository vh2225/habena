import { describe, it, expect, beforeEach } from "vitest";
import { BudgetEnforcer } from "../../src/cost/budget.js";
import { CostTracker } from "../../src/cost/tracker.js";
import type { BudgetConfig } from "../../src/policy/types.js";

describe("BudgetEnforcer", () => {
  let tracker: CostTracker;
  let budget: BudgetConfig;

  beforeEach(() => {
    tracker = new CostTracker();
    budget = { daily: 30, per_session: 10, per_request: 5, on_exceed: "deny" };
  });

  it("allows when under all limits", () => {
    const enforcer = new BudgetEnforcer(tracker, budget);
    const decision = enforcer.check({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      proposedCost: 1.00,
    });
    expect(decision).toBeNull();
  });

  it("denies when proposed cost exceeds per_request limit", () => {
    const enforcer = new BudgetEnforcer(tracker, budget);
    const decision = enforcer.check({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      proposedCost: 6.00,
    });
    expect(decision?.action).toBe("deny");
    expect(decision?.enforcement).toBe("hard_mandatory");
    expect(decision?.reason).toContain("per-request");
  });

  it("denies when session spend + proposed exceeds per_session", () => {
    tracker.record({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      tool: "x",
      cost: 9.00,
      timestamp: new Date(),
    });
    const enforcer = new BudgetEnforcer(tracker, budget);
    const decision = enforcer.check({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      proposedCost: 2.00,
    });
    expect(decision?.action).toBe("deny");
    expect(decision?.reason).toContain("session");
  });

  it("denies when daily spend + proposed exceeds daily", () => {
    tracker.record({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      tool: "x",
      cost: 29.00,
      timestamp: new Date(),
    });
    const enforcer = new BudgetEnforcer(tracker, budget);
    const decision = enforcer.check({
      agentType: "openclaw",
      instanceId: "openclaw/session-b",
      proposedCost: 2.00,
    });
    expect(decision?.action).toBe("deny");
    expect(decision?.reason).toContain("daily");
  });

  it("denies when the per-day call count is exhausted", () => {
    // Call-count limits are the runaway-loop guard that works without cost
    // attribution: every allowed call is one record, regardless of cost.
    const enforcer = new BudgetEnforcer(tracker, { calls: { per_day: 2 } });
    const call = { agentType: "openclaw", instanceId: "i1", proposedCost: 0 };
    const rec = () => tracker.record({ agentType: "openclaw", instanceId: "i1", tool: "x", cost: 0, timestamp: new Date() });

    expect(enforcer.check(call)).toBeNull();
    rec();
    expect(enforcer.check(call)).toBeNull();
    rec();
    const decision = enforcer.check(call);
    expect(decision?.action).toBe("deny");
    expect(decision?.enforcement).toBe("hard_mandatory");
    expect(decision?.reason).toMatch(/2 calls.*day/);
  });

  it("per-minute call limit uses a rolling window", () => {
    const enforcer = new BudgetEnforcer(tracker, { calls: { per_minute: 1 } });
    const call = { agentType: "openclaw", instanceId: "i1", proposedCost: 0 };

    // An old call outside the window doesn't count.
    tracker.record({ agentType: "openclaw", instanceId: "i1", tool: "x", cost: 0, timestamp: new Date(Date.now() - 90_000) });
    expect(enforcer.check(call)).toBeNull();

    tracker.record({ agentType: "openclaw", instanceId: "i1", tool: "x", cost: 0, timestamp: new Date() });
    expect(enforcer.check(call)?.action).toBe("deny");
  });

  it("call limits are per agent type", () => {
    const enforcer = new BudgetEnforcer(tracker, { calls: { per_hour: 1 } });
    tracker.record({ agentType: "openclaw", instanceId: "i1", tool: "x", cost: 0, timestamp: new Date() });
    expect(enforcer.check({ agentType: "openclaw", instanceId: "i1", proposedCost: 0 })?.action).toBe("deny");
    expect(enforcer.check({ agentType: "research-bot", instanceId: "i2", proposedCost: 0 })).toBeNull();
  });

  it("returns null when no budget configured", () => {
    const enforcer = new BudgetEnforcer(tracker, {});
    const decision = enforcer.check({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      proposedCost: 1000.00,
    });
    expect(decision).toBeNull();
  });

  it("budget denial is hard_mandatory with critical risk", () => {
    const enforcer = new BudgetEnforcer(tracker, budget);
    const decision = enforcer.check({
      agentType: "openclaw",
      instanceId: "openclaw/session-a",
      proposedCost: 6.00,
    });
    expect(decision?.enforcement).toBe("hard_mandatory");
    expect(decision?.risk_level).toBe("critical");
  });
});
