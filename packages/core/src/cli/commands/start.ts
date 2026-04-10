import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import chalk from "chalk";
import { join } from "node:path";
import { getConfigPath, getAgentsPath, getAuditDbPath, getConfigDir } from "../../config/paths.js";
import { loadYaml } from "../../config/loader.js";
import type { AgentGuardConfig } from "../../policy/types.js";
import { PolicyEngine } from "../../policy/engine.js";
import { CostTracker } from "../../cost/tracker.js";
import { BudgetEnforcer } from "../../cost/budget.js";
import { AuditLogger } from "../../audit/logger.js";
import { InstanceTracker } from "../../identity/instances.js";
import { AgentRegistry } from "../../identity/registry.js";
import { Forwarder } from "../../proxy/forwarder.js";
import { ProxyDispatcher } from "../../proxy/server.js";
import { ApprovalQueue } from "../../approval/queue.js";
import { IpcServer } from "../../ipc/server.js";

export async function startCommand(): Promise<void> {
  const config = loadYaml<AgentGuardConfig>(getConfigPath()) ?? {};
  const rules = config.rules ?? [];
  const budgetConfig = config.budget ?? {};

  const policy = new PolicyEngine(rules);
  const tracker = new CostTracker();
  const budget = new BudgetEnforcer(tracker, budgetConfig);
  const audit = new AuditLogger(getAuditDbPath());
  const instances = new InstanceTracker();
  const forwarder = new Forwarder();

  const agentRegistry = new AgentRegistry(getAgentsPath());
  const agents = agentRegistry.list();

  // Approval queue + IPC server
  const approval = new ApprovalQueue({
    timeoutAction: config.approval?.timeout_action ?? "deny",
  });
  const socketPath = join(getConfigDir(), "agentguard.sock");
  const ipcServer = new IpcServer(approval, socketPath);
  try {
    await ipcServer.start();
    console.error(chalk.gray(`IPC:    ${socketPath}`));
  } catch (err) {
    console.error(chalk.yellow(`! Failed to start IPC server: ${(err as Error).message}`));
    console.error(chalk.yellow("  Approval requests will auto-deny."));
  }

  const dispatcher = new ProxyDispatcher({
    policy,
    tracker,
    budget,
    audit,
    instances,
    forwarder,
    approval,
    approvalTimeoutMs: parseDurationToMs(config.approval?.timeout ?? "5m"),
  });

  const server = new Server(
    { name: "agentguard", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "agentguard_proxy",
        description:
          "AgentGuard generic proxy tool. Pass through any downstream tool call via arguments: tool_name, tool_args.",
        inputSchema: {
          type: "object",
          properties: {
            tool_name: { type: "string", description: "The downstream tool to invoke" },
            tool_args: { type: "object", description: "Arguments for the downstream tool" },
            estimated_cost: { type: "number", description: "Estimated cost in USD" },
            agent_type: { type: "string", description: "Agent type identifier" },
          },
          required: ["tool_name", "agent_type"],
        },
      },
    ],
  }));

  const instanceByAgent = new Map<string, string>();

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments as {
      tool_name: string;
      tool_args?: Record<string, unknown>;
      estimated_cost?: number;
      agent_type: string;
    };

    let instanceId = instanceByAgent.get(args.agent_type);
    if (!instanceId) {
      const instance = instances.create(args.agent_type);
      instanceId = instance.instanceId;
      instanceByAgent.set(args.agent_type, instanceId);
    }

    const result = await dispatcher.handleToolCall({
      agentType: args.agent_type,
      instanceId,
      tool: args.tool_name,
      args: args.tool_args ?? {},
      estimatedCost: args.estimated_cost ?? 0,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              decision: result.decision.action,
              reason: result.decision.reason,
              enforcement: result.decision.enforcement,
              forwarded: result.forwarded,
            },
            null,
            2
          ),
        },
      ],
      isError: result.decision.action !== "allow",
    };
  });

  console.error(chalk.green("AgentGuard proxy started (stdio transport)"));
  console.error(chalk.gray(`Config: ${getConfigPath()}`));
  console.error(chalk.gray(`Audit: ${getAuditDbPath()}`));
  console.error(chalk.gray(`Registered agents: ${agents.length}`));

  const shutdown = async () => {
    console.error(chalk.yellow("\nShutting down AgentGuard..."));
    await ipcServer.stop().catch(() => {});
    approval.shutdown();
    audit.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h)$/);
  if (!match) return 5 * 60 * 1000;
  const v = parseInt(match[1], 10);
  const unit = match[2];
  return unit === "s" ? v * 1000 : unit === "m" ? v * 60 * 1000 : v * 60 * 60 * 1000;
}
