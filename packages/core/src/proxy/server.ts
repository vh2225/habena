import type { PolicyEngine } from "../policy/engine.js";
import type { CostTracker } from "../cost/tracker.js";
import type { BudgetEnforcer } from "../cost/budget.js";
import type { AuditLogger } from "../audit/logger.js";
import type { InstanceTracker } from "../identity/instances.js";
import type { Forwarder } from "./forwarder.js";
import type { PolicyDecision } from "../policy/decisions.js";

export interface DispatcherDeps {
  policy: PolicyEngine;
  tracker: CostTracker;
  budget: BudgetEnforcer;
  audit: AuditLogger;
  instances: InstanceTracker;
  forwarder: Forwarder;
}

export interface ToolCallRequest {
  agentType: string;
  instanceId: string;
  tool: string;
  args: Record<string, unknown>;
  estimatedCost: number;
  mcpServer?: string;
}

export interface ToolCallResult {
  decision: PolicyDecision;
  forwarded: boolean;
  result?: unknown;
  error?: string;
}

/**
 * ProxyDispatcher is the pure-logic core of the proxy.
 * The MCP server transport (stdio/HTTP) wraps this class and
 * translates MCP protocol messages into handleToolCall() invocations.
 */
export class ProxyDispatcher {
  constructor(private deps: DispatcherDeps) {}

  async handleToolCall(req: ToolCallRequest): Promise<ToolCallResult> {
    const startTime = Date.now();

    // 1. Budget check (hard_mandatory, runs first)
    const budgetDecision = this.deps.budget.check({
      agentType: req.agentType,
      instanceId: req.instanceId,
      proposedCost: req.estimatedCost,
    });

    let decision: PolicyDecision;
    if (budgetDecision) {
      decision = budgetDecision;
    } else {
      // 2. Policy engine evaluation
      decision = this.deps.policy.evaluate({
        tool: req.tool,
        args: req.args,
      });
    }

    // 3. Log the decision
    const latencyMs = Date.now() - startTime;
    this.deps.audit.log({
      timestamp: new Date(),
      agentType: req.agentType,
      instanceId: req.instanceId,
      tool: req.tool,
      args: req.args,
      mcpServer: req.mcpServer ?? this.deps.forwarder.routeFor(req.tool)?.name ?? "unknown",
      decision: decision.action,
      tier: decision.tier,
      ruleMatched: decision.rule_matched,
      reason: decision.reason,
      cost: decision.action === "allow" ? req.estimatedCost : null,
      latencyMs,
      resultStatus: decision.action === "allow" ? "success" : "error",
    });

    // 4. Record spend + forward if allowed
    if (decision.action === "allow") {
      this.deps.tracker.record({
        agentType: req.agentType,
        instanceId: req.instanceId,
        tool: req.tool,
        cost: req.estimatedCost,
        timestamp: new Date(),
      });
      this.deps.instances.recordSpend(req.instanceId, req.estimatedCost);

      // Phase 1: mark as forwarded but don't actually invoke forwarder.forward()
      // (real MCP client connections are Phase 2).
      return { decision, forwarded: true, result: null };
    }

    return { decision, forwarded: false };
  }
}
