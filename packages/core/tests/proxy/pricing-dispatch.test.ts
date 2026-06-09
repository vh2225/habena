import { describe, it, expect } from "vitest";
import { ProxyDispatcher, type DispatcherDeps } from "../../src/proxy/server.js";
import { CostTracker } from "../../src/cost/tracker.js";
import { BudgetEnforcer } from "../../src/cost/budget.js";
import type { PolicyDecision } from "../../src/policy/decisions.js";

function deps(over: Partial<DispatcherDeps> = {}): DispatcherDeps & { logged: any[] } {
  const allow: PolicyDecision = {
    action: "allow", reason: "ok", tool: "x",
    enforcement: "soft_mandatory", risk_level: "low", tier: "user",
  };
  const logged: any[] = [];
  const tracker = new CostTracker();
  return {
    policy: { evaluate: () => ({ ...allow }), addSessionOverride() {} } as any,
    tracker,
    budget: new BudgetEnforcer(tracker, {}),
    audit: { log: (e: any) => logged.push(e) } as any,
    instances: { recordSpend() {} } as any,
    logged,
    ...over,
  } as DispatcherDeps & { logged: any[] };
}

const call = (tool = "web_search") => ({
  agentType: "a", instanceId: "i", tool, args: {}, estimatedCost: 0, mcpServer: "brave",
});

describe("ProxyDispatcher pricing", () => {
  it("declared per-tool pricing lands in the audit cost", async () => {
    const d = deps({ pricing: { web_search: 0.01 } });
    const res = await new ProxyDispatcher(d).handleToolCall(call());
    expect(res.decision.action).toBe("allow");
    expect(d.logged[0].cost).toBe(0.01);
  });

  it("unpriced tools still cost 0", async () => {
    const d = deps({ pricing: { web_search: 0.01 } });
    await new ProxyDispatcher(d).handleToolCall(call("read_file"));
    expect(d.logged[0].cost).toBe(0);
  });

  it("dollar overrun with on_exceed deny blocks a priced call", async () => {
    const tracker = new CostTracker();
    const d = deps({
      tracker,
      budget: new BudgetEnforcer(tracker, { per_request: 0.005, on_exceed: "deny" }),
      pricing: { web_search: 0.01 },
    });
    const res = await new ProxyDispatcher(d).handleToolCall(call());
    expect(res.decision.action).toBe("deny");
    expect(res.decision.reason).toContain("per-request");
    expect(res.forwarded).toBe(false);
  });

  it("default warn mode lets a priced overrun through", async () => {
    const tracker = new CostTracker();
    const d = deps({
      tracker,
      budget: new BudgetEnforcer(tracker, { per_request: 0.005 }),
      pricing: { web_search: 0.01 },
    });
    const res = await new ProxyDispatcher(d).handleToolCall(call());
    expect(res.decision.action).toBe("allow");
    expect(res.forwarded).toBe(true);
  });

  it("a budget require_approval cannot bypass a policy deny (stricter combine)", async () => {
    const tracker = new CostTracker();
    const denyPolicy: PolicyDecision = {
      action: "deny", reason: "policy says no", tool: "web_search",
      enforcement: "hard_mandatory", risk_level: "critical", tier: "built_in",
    };
    const d = deps({
      tracker,
      policy: { evaluate: () => ({ ...denyPolicy }), addSessionOverride() {} } as any,
      budget: new BudgetEnforcer(tracker, { per_request: 0.005, on_exceed: "require_approval" }),
      pricing: { web_search: 0.01 },
      approval: { request: async () => ({ choice: "allow_once" }) } as any,
    });
    const res = await new ProxyDispatcher(d).handleToolCall(call());
    expect(res.decision.action).toBe("deny");
    expect(res.decision.reason).toBe("policy says no");
  });
});
