import type { PolicyEngine } from "../policy/engine.js";
import { stricter } from "../policy/engine.js";
import type { ThreatEngine } from "../threat/engine.js";
import type { CostTracker } from "../cost/tracker.js";
import type { BudgetEnforcer } from "../cost/budget.js";
import type { AuditLogger } from "../audit/logger.js";
import type { InstanceTracker } from "../identity/instances.js";
import type { PolicyDecision } from "../policy/decisions.js";
import type { ApprovalQueue } from "../approval/queue.js";
import type { Rule } from "../policy/types.js";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { DownstreamManager } from "../downstream/manager.js";

export interface DispatcherDeps {
  policy: PolicyEngine;
  tracker: CostTracker;
  budget: BudgetEnforcer;
  audit: AuditLogger;
  instances: InstanceTracker;
  approval?: ApprovalQueue;           // NEW
  approvalTimeoutMs?: number;         // NEW, default 5 minutes
  threat?: ThreatEngine;
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
  /**
   * Whether the call cleared policy/budget/approval and is authorized to be
   * forwarded downstream. The dispatcher does NOT forward — the MCP server
   * layer (createMcpServer) performs the actual downstream.forward() call.
   */
  forwarded: boolean;
  error?: string;
}

/**
 * ProxyDispatcher is the pure-logic core of the proxy. Given a tool call it
 * runs budget → policy → approval and returns the resulting decision plus
 * whether the call is authorized to forward. It does not perform forwarding
 * itself; the MCP server transport (stdio/HTTP) wraps this class, translates
 * MCP protocol messages into handleToolCall() invocations, and forwards
 * authorized calls to the downstream server.
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

    // 2a. Threat check — may escalate the decision (deny / require_approval).
    const threatDecision = this.deps.threat?.checkCall(req.mcpServer ?? "unknown", req.tool, req.args);
    if (threatDecision) {
      decision = stricter(decision, threatDecision);
      // A warn-mode finding is an advisory allow, which loses stricter() to a
      // mandatory policy allow. The call still goes through, but the threat
      // reason must reach the audit log — that is the whole point of warn.
      if (decision.action === "allow" && !decision.reason.includes("threat:")) {
        decision = { ...decision, reason: threatDecision.reason };
      }
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
      mcpServer: req.mcpServer ?? "unknown",
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

      // Authorized: the MCP server layer will forward this call downstream.
      return { decision, forwarded: true };
    }

    return { decision, forwarded: false };
  }
}

export interface McpServerDeps {
  dispatcher: ProxyDispatcher;
  downstream: DownstreamManager;
  instances: InstanceTracker;
}

/**
 * Creates the MCP stdio Server that external clients (OpenClaw, Claude Desktop, etc.)
 * connect to. Routes tools/list to the aggregated catalog from DownstreamManager
 * and tools/call through the policy/budget/approval dispatcher.
 */
export function createMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer(
    { name: "habena", version: "0.2.0" },
    { capabilities: { tools: {} } }
  );

  let currentInstanceId: string | null = null;
  let currentAgentType = "unknown";

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: deps.downstream.listTools().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema ?? { type: "object" },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const owner = deps.downstream.findTool(name);
    if (!owner) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    // Lazily create an instance for this MCP connection.
    if (!currentInstanceId) {
      const instance = deps.instances.create(currentAgentType);
      currentInstanceId = instance.instanceId;
    }

    const result = await deps.dispatcher.handleToolCall({
      agentType: currentAgentType,
      instanceId: currentInstanceId,
      tool: owner.originalName,
      args: (args as Record<string, unknown>) ?? {},
      estimatedCost: 0,
      mcpServer: owner.server,
    });

    if (result.decision.action !== "allow") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              decision: result.decision.action,
              reason: result.decision.reason,
              enforcement: result.decision.enforcement,
            }),
          },
        ],
        isError: true,
      };
    }

    try {
      const downstreamResult = await deps.downstream.forward(
        owner.server,
        owner.originalName,
        (args as Record<string, unknown>) ?? {}
      );
      return downstreamResult as {
        content: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: `Downstream error: ${(err as Error).message}` },
        ],
        isError: true,
      };
    }
  });

  // Set the agent type from HABENA_AGENT (preferred) or the legacy
  // AGENTGUARD_AGENT env var, keeping old launchers working.
  const agentEnv = process.env.HABENA_AGENT ?? process.env.AGENTGUARD_AGENT;
  if (agentEnv) {
    currentAgentType = agentEnv;
  }

  return server;
}
