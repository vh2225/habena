#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";
import { logsCommand } from "./commands/logs.js";
import { agentAddCommand, agentListCommand } from "./commands/agent.js";

const program = new Command();

program
  .name("agentguard")
  .description("MCP middleware proxy for AI agent safety")
  .version("0.1.0");

program
  .command("init")
  .description("Create default config at ~/.agentguard/config.yaml")
  .option("--force", "overwrite existing files")
  .action(initCommand);

program
  .command("start")
  .description("Start MCP proxy server (stdio)")
  .action(startCommand);

program
  .command("logs")
  .description("Query audit logs")
  .option("--agent <name>", "Filter by agent name")
  .option("--last <duration>", "Show logs from last duration (e.g., 24h, 7d)")
  .option("--decision <type>", "Filter by decision (allow, deny, require_approval)")
  .option("--limit <n>", "Max entries to show", "50")
  .action(logsCommand);

const agentCmd = program.command("agent").description("Manage agent registrations");

agentCmd
  .command("add")
  .description("Register a new agent type")
  .requiredOption("--name <name>", "Agent name")
  .option("--budget-daily <amount>", "Daily budget in USD", parseFloat)
  .option("--budget-per-session <amount>", "Per-session budget in USD", parseFloat)
  .option("--from <baseAgent>", "Create as variant of existing agent")
  .action(agentAddCommand);

agentCmd
  .command("list")
  .description("List registered agents")
  .action(agentListCommand);

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
