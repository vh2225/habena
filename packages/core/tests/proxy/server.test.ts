import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProxyDispatcher } from "../../src/proxy/server.js";
import { PolicyEngine } from "../../src/policy/engine.js";
import { CostTracker } from "../../src/cost/tracker.js";
import { BudgetEnforcer } from "../../src/cost/budget.js";
import { AuditLogger } from "../../src/audit/logger.js";
import { InstanceTracker } from "../../src/identity/instances.js";
import { Forwarder } from "../../src/proxy/forwarder.js";

describe("ProxyDispatcher", () => {
  let dir: string;
  let dispatcher: ProxyDispatcher;
  let audit: AuditLogger;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-"));
    const policy = new PolicyEngine([
      { match: { tool: "github_*" }, action: "allow" },
      { match: { tool: "stripe_*" }, action: "deny", reason: "No payments" },
    ]);
    const tracker = new CostTracker();
    const budget = new BudgetEnforcer(tracker, { per_request: 5 });
    audit = new AuditLogger(join(dir, "audit.db"));
    const instances = new InstanceTracker();
    const forwarder = new Forwarder();
    forwarder.addServer({ name: "github", command: "x", toolPrefixes: ["github_"] });

    dispatcher = new ProxyDispatcher({
      policy,
      tracker,
      budget,
      audit,
      instances,
      forwarder,
    });
  });

  afterEach(() => {
    audit.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("denies when policy denies", async () => {
    const result = await dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "stripe_charge",
      args: { amount: 100 },
      estimatedCost: 0,
    });
    expect(result.decision.action).toBe("deny");
    expect(result.forwarded).toBe(false);
  });

  it("denies when budget exceeds per_request", async () => {
    const result = await dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "github_search",
      args: {},
      estimatedCost: 10,
    });
    expect(result.decision.action).toBe("deny");
    expect(result.decision.reason).toContain("per-request");
  });

  it("logs every decision to the audit store", async () => {
    await dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "github_search",
      args: { query: "safety" },
      estimatedCost: 0.01,
    });
    await dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "stripe_charge",
      args: {},
      estimatedCost: 0,
    });
    const logs = audit.query({});
    expect(logs).toHaveLength(2);
    expect(logs.some((l) => l.decision === "allow")).toBe(true);
    expect(logs.some((l) => l.decision === "deny")).toBe(true);
  });

  it("records cost for allowed calls", async () => {
    await dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "github_search",
      args: {},
      estimatedCost: 0.50,
    });
    const logs = audit.query({});
    expect(logs[0].cost).toBeCloseTo(0.50);
  });
});
