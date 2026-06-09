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
import { ApprovalQueue } from "../../src/approval/queue.js";

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
    const budget = new BudgetEnforcer(tracker, { per_request: 5, on_exceed: "deny" });
    audit = new AuditLogger(join(dir, "audit.db"));
    const instances = new InstanceTracker();

    dispatcher = new ProxyDispatcher({
      policy,
      tracker,
      budget,
      audit,
      instances,
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

describe("ProxyDispatcher with ApprovalQueue", () => {
  let dir: string;
  let dispatcher: ProxyDispatcher;
  let audit: AuditLogger;
  let queue: ApprovalQueue;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-"));
    const policy = new PolicyEngine([
      { match: { tool: "gmail_send" }, action: "require_approval", reason: "needs approval" },
    ]);
    const tracker = new CostTracker();
    const budget = new BudgetEnforcer(tracker, {});
    audit = new AuditLogger(join(dir, "audit.db"));
    const instances = new InstanceTracker();
    queue = new ApprovalQueue();

    dispatcher = new ProxyDispatcher({
      policy,
      tracker,
      budget,
      audit,
      instances,
      approval: queue,
      approvalTimeoutMs: 1000,
    });
  });

  afterEach(() => {
    audit.close();
    queue.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("waits for human approval and proceeds on allow_once", async () => {
    const pendingPromise = dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "gmail_send",
      args: { to: "x" },
      estimatedCost: 0,
    });
    await new Promise((r) => setTimeout(r, 10));
    const pending = queue.list();
    expect(pending).toHaveLength(1);
    queue.respond(pending[0].id, { choice: "allow_once" });
    const result = await pendingPromise;
    expect(result.decision.action).toBe("allow");
    expect(result.forwarded).toBe(true);
  });

  it("denies on human deny response", async () => {
    const pendingPromise = dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "gmail_send",
      args: { to: "x" },
      estimatedCost: 0,
    });
    await new Promise((r) => setTimeout(r, 10));
    const pending = queue.list();
    queue.respond(pending[0].id, { choice: "deny" });
    const result = await pendingPromise;
    expect(result.decision.action).toBe("deny");
    expect(result.forwarded).toBe(false);
  });

  it("auto-denies on timeout when no human responds", async () => {
    const pendingPromise = dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "gmail_send",
      args: { to: "x" },
      estimatedCost: 0,
    });
    const result = await pendingPromise;
    expect(result.decision.action).toBe("deny");
    expect(result.decision.reason).toContain("denied");
  });
});
