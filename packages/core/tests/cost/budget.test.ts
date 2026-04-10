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
