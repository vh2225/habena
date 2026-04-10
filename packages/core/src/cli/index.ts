#!/usr/bin/env node

/**
 * AgentGuard CLI entrypoint.
 *
 * Commands:
 *   agentguard init          - Create default config at ~/.agentguard/config.yaml
 *   agentguard start         - Start MCP proxy (stdio mode)
 *   agentguard start --http  - Start MCP proxy (HTTP mode on localhost:7600)
 *   agentguard watch         - Interactive approval terminal
 *   agentguard logs          - Query audit logs
 *   agentguard learn         - Start learning/observe mode for an agent
 *   agentguard dashboard     - Open local web dashboard
 *   agentguard config        - View/edit configuration
 */

import { Command } from "commander";

const program = new Command();

program
  .name("agentguard")
  .description("MCP middleware proxy for AI agent safety")
  .version("0.1.0");

program
  .command("init")
  .description("Create default config at ~/.agentguard/config.yaml")
  .action(async () => {
    // TODO: Import and run init command
    console.log("agentguard init — not yet implemented");
  });

program
  .command("start")
  .description("Start MCP proxy server")
  .option("--http", "Use HTTP transport instead of stdio")
  .option("--port <port>", "HTTP port", "7600")
  .action(async (options) => {
    // TODO: Import and run start command
    console.log("agentguard start — not yet implemented");
  });

program
  .command("watch")
  .description("Interactive approval terminal")
  .action(async () => {
    // TODO: Import and run watch command
    console.log("agentguard watch — not yet implemented");
  });

program
  .command("logs")
  .description("Query audit logs")
  .option("--agent <name>", "Filter by agent name")
  .option("--last <duration>", "Show logs from last duration (e.g., 24h, 7d)")
  .option("--decision <type>", "Filter by decision (allow, deny, require_approval)")
  .option("--limit <n>", "Max entries to show", "50")
  .action(async (options) => {
    // TODO: Import and run logs command
    console.log("agentguard logs — not yet implemented");
  });

program
  .command("learn")
  .description("Start learning mode for an agent")
  .requiredOption("--agent <name>", "Agent name to observe")
  .option("--duration <duration>", "Observation duration", "24h")
  .action(async (options) => {
    // TODO: Import and run learn command
    console.log("agentguard learn — not yet implemented");
  });

program
  .command("dashboard")
  .description("Open local web dashboard")
  .option("--port <port>", "Dashboard port", "7700")
  .action(async (options) => {
    // TODO: Import and run dashboard command
    console.log("agentguard dashboard — not yet implemented");
  });

program.parse();
