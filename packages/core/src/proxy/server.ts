import type { PolicyEngine } from "../policy/engine.js";
import type { CostTracker } from "../cost/tracker.js";
import type { BudgetEnforcer } from "../cost/budget.js";
import type { AuditLogger } from "../audit/logger.js";
import type { InstanceTracker } from "../identity/instances.js";
import type { Forwarder } from "./forwarder.js";
import type { PolicyDecision } from "../policy/decisions.js";
import type { ApprovalQueue } from "../approval/queue.js";
import type { Rule } from "../policy/types.js";

export interface DispatcherDeps {
  policy: PolicyEngine;
  tracker: CostTracker;
  budget: BudgetEnforcer;
  audit: AuditLogger;
  instances: InstanceTracker;
  forwarder: Forwarder;
  approval?: ApprovalQueue;           // NEW
  approvalTimeoutMs?: number;         // NEW, default 5 minutes
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

    // 2b. If decision is require_approval AND approval queue is available, ask the human.
    if (decision.action === "require_approval" && this.deps.approval) {
      const timeoutMs = this.deps.approvalTimeoutMs ?? 5 * 60 * 1000;
      const response = await this.deps.approval.request(decision, req, timeoutMs);

      if (response.choice === "allow_once") {
        decision = { ...decision, action: "allow", reason: `approved: ${decision.reason}` };
      } else if (response.choice === "allow_session") {
        const durationMs = response.durationMs ?? 60 * 60 * 1000;
        const rule: Rule = {
          match: { tool: req.tool },
          action: "allow",
          reason: `session approval: ${decision.reason}`,
        };
        this.deps.policy.addSessionOverride(rule, new Date(Date.now() + durationMs));
        decision = { ...decision, action: "allow", tier: "session", reason: `session approved: ${decision.reason}` };
      } else {
        decision = { ...decision, action: "deny", reason: `denied: ${decision.reason}` };
      }
    } else if (decision.action === "require_approval") {
      decision = { ...decision, action: "deny", reason: `no approval handler: ${decision.reason}` };
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
