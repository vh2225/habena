import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import chalk from "chalk";
import { join } from "node:path";
import { getConfigPath, getAgentsPath, getAuditDbPath, getConfigDir } from "../../config/paths.js";
import { loadYaml, loadConfigWithPacks, loadHostPolicy } from "../../config/loader.js";
import type { AgentGuardConfig } from "../../policy/types.js";
import { PolicyEngine } from "../../policy/engine.js";
import { CostTracker } from "../../cost/tracker.js";
import { BudgetEnforcer } from "../../cost/budget.js";
import { AuditLogger } from "../../audit/logger.js";
import { InstanceTracker } from "../../identity/instances.js";
import { AgentRegistry } from "../../identity/registry.js";
import { ProxyDispatcher } from "../../proxy/server.js";
import { ApprovalQueue } from "../../approval/queue.js";
import { IpcServer } from "../../ipc/server.js";
import { DownstreamManager } from "../../downstream/manager.js";
import { createMcpServer } from "../../proxy/server.js";
import { runDoctor } from "../../doctor/runner.js";

export async function startCommand(): Promise<void> {
  const { config, missingPacks } = loadConfigWithPacks(getConfigPath());
  if (missingPacks.length > 0) {
    console.error(
      chalk.yellow(
        `! extends: could not resolve pack(s): ${missingPacks.join(", ")} — continuing without them`
      )
    );
  }
  const rules = config.rules ?? [];
  const budgetConfig = config.budget ?? {};

  const hostPolicy = loadHostPolicy();
  if (hostPolicy.missingPacks.length > 0) {
    console.error(
      chalk.yellow(
        `! host-policy extends: could not resolve pack(s): ${hostPolicy.missingPacks.join(", ")} — continuing without them`
      )
    );
  }
  if (hostPolicy.exists) {
    console.error(
      chalk.gray(
        `Host policy: ${hostPolicy.path} (${hostPolicy.rules.length} floor rule${hostPolicy.rules.length === 1 ? "" : "s"})`
      )
    );
  }

  const policy = new PolicyEngine(rules, hostPolicy.rules);
  const tracker = new CostTracker();
  const budget = new BudgetEnforcer(tracker, budgetConfig);
  const audit = new AuditLogger(getAuditDbPath());
  const instances = new InstanceTracker();

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
    approval,
    approvalTimeoutMs: parseDurationToMs(config.approval?.timeout ?? "5m"),
  });

  // Spawn downstream MCP servers
  const downstream = new DownstreamManager(config.mcp_servers ?? {});
  try {
    await downstream.start();
    const status = downstream.status();
    const healthy = status.filter((s) => s.alive && s.authStatus !== "auth_failed").length;
    const total = status.length;
    console.error(chalk.gray(`Downstreams: ${healthy}/${total} healthy`));
    for (const s of status) {
      if (!s.alive) {
        console.error(chalk.yellow(`  ✗ ${s.name}: ${s.error}`));
        continue;
      }
      if (s.authStatus === "auth_failed") {
        console.error(
          chalk.yellow(
            `  ⚠ ${s.name} (${s.toolCount} tools, auth failed: ${s.authError ?? "unknown"})`
          )
        );
      } else if (s.authStatus === "authenticated") {
        console.error(chalk.gray(`  ✓ ${s.name} (${s.toolCount} tools, authenticated)`));
      } else {
        console.error(chalk.gray(`  ✓ ${s.name} (${s.toolCount} tools, auth unchecked)`));
      }
    }
  } catch (err) {
    console.error(chalk.yellow(`! Downstream startup failed: ${(err as Error).message}`));
  }

  const mcpServer = createMcpServer({
    dispatcher,
    downstream,
    instances,
  });

  console.error(chalk.green("AgentGuard proxy started (stdio transport)"));
  console.error(chalk.gray(`Config: ${getConfigPath()}`));
  console.error(chalk.gray(`Audit: ${getAuditDbPath()}`));
  console.error(chalk.gray(`Registered agents: ${agents.length}`));

  // Boot-time doctor subset — checks that are safe to run at startup
  // (skip proxy-reachable + downstream-reachable: we just started them,
  // they're covered above). Silent on pass; prints a one-liner if any
  // check comes back non-green.
  runDoctor({ only: ["node-version", "audit-db-writable", "openclaw-pointed-at-us"] })
    .then((results) => {
      const problems = results.filter((r) => r.status !== "pass");
      if (problems.length === 0) return;
      for (const p of problems) {
        const icon = p.status === "warn" ? chalk.yellow("⚠") : chalk.red("✗");
        console.error(`${icon} ${chalk.bold(p.name)}: ${p.detail}`);
        if (p.fixHint) console.error(chalk.gray(`  └─ ${p.fixHint}`));
      }
      console.error(chalk.gray("  (run `agentguard doctor` for the full report)"));
    })
    .catch(() => { /* boot checks are advisory; never block startup */ });

  const shutdown = async () => {
    console.error(chalk.yellow("\nShutting down AgentGuard..."));
    await downstream.stop().catch(() => {});
    await ipcServer.stop().catch(() => {});
    approval.shutdown();
    audit.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h)$/);
  if (!match) return 5 * 60 * 1000;
  const v = parseInt(match[1], 10);
  const unit = match[2];
  return unit === "s" ? v * 1000 : unit === "m" ? v * 60 * 1000 : v * 60 * 60 * 1000;
}
