#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";
import { logsCommand } from "./commands/logs.js";
import { agentAddCommand, agentListCommand } from "./commands/agent.js";
import { watchCommand } from "./commands/watch.js";
import { installOpenclawCommand, uninstallOpenclawCommand } from "./commands/install.js";
import { doctorCommand } from "./commands/doctor.js";
import {
  policyPresetApplyCommand,
  policyPresetListCommand,
  policyPresetShowCommand,
  policyExplainCommand,
} from "./commands/policy.js";
import {
  downstreamListCommand,
  downstreamRemoveCommand,
  downstreamAddFilesystemCommand,
  downstreamAddGmailCommand,
} from "./commands/downstream.js";
import {
  approvalsListCommand,
  approvalsRespondCommand,
  approvalsForwardCommand,
} from "./commands/approvals.js";
import { chatStatusCommand, chatRearmCommand } from "./commands/chat.js";
import { learnCommand } from "./commands/learn.js";
import { packsListCommand, packsShowCommand } from "./commands/packs.js";
import { securityAuditCommand } from "./commands/security.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { lockdownCommand, sessionListCommand, sessionRevokeCommand } from "./commands/session.js";
import { VERSION } from "../version.js";

const program = new Command();

program
  .name("habena")
  .description("MCP middleware proxy for AI agent safety")
  .version(VERSION);

program
  .command("init")
  .description("Create default config at ~/.habena/config.yaml")
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

program
  .command("watch")
  .description("Interactive approval terminal")
  .action(watchCommand);

program
  .command("dashboard")
  .description("Launch the local web dashboard (default http://localhost:7700)")
  .option("--port <port>", "Port to serve on", "7700")
  .action((opts: { port?: string }) => dashboardCommand(opts));

program
  .command("lockdown")
  .description("Panic button: deny every tool call until released (on | off | status)")
  .argument("[state]", "on | off | status (default: status)")
  .action((state: string | undefined) => lockdownCommand(state));

const sessionCmd = program.command("session").description("Inspect or revoke active allow_session approvals");
sessionCmd
  .command("list")
  .description("List active session approvals (and lockdown state)")
  .option("--json", "Emit JSON")
  .action((opts: { json?: boolean }) => sessionListCommand(opts));
sessionCmd
  .command("revoke")
  .description("Revoke a session approval before it expires")
  .argument("<id>", "Override id from `habena session list`")
  .action((id: string) => sessionRevokeCommand(id));

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

const installCmd = program.command("install").description("Install Habena into an MCP client");
installCmd
  .command("openclaw")
  .description("Wire Habena into OpenClaw's config")
  .option("--dry-run", "Show what would happen without writing")
  .option("--force", "Overwrite existing Habena entry")
  .action(installOpenclawCommand);

const approvalsCmd = program
  .command("approvals")
  .description("List, respond to, or forward pending approvals via IPC");
approvalsCmd
  .command("list")
  .description("Print pending approvals (one-shot IPC query)")
  .option("--json", "Output as JSON")
  .action(approvalsListCommand);
approvalsCmd
  .command("respond <id> <choice>")
  .description("Resolve a pending approval (choice: allow_once|allow_session|deny)")
  .option("--duration-ms <ms>", "Session duration when choice=allow_session")
  .option("--note <text>", "Optional note recorded in the audit log")
  .action(approvalsRespondCommand);
approvalsCmd
  .command("forward")
  .description("Stream approval events to a webhook URL (for Zapier/Discord/ntfy/etc)")
  .requiredOption("--url <url>", "Webhook URL to POST approval events to")
  .option("--hmac-secret <s>", "Secret for signing payloads with HMAC-SHA256 (or set AGENTGUARD_WEBHOOK_HMAC)")
  .option("--hmac-header <name>", "Header name carrying the HMAC (default: x-agentguard-signature)")
  .action(approvalsForwardCommand);

const chatCmd = program
  .command("chat")
  .description("Chat bridge status and rate-limit re-arm (IPC)");
chatCmd
  .command("status")
  .description("Show chat bridge/running/disarmed-channel/queue-depth state")
  .action(chatStatusCommand);
chatCmd
  .command("rearm <channel>")
  .description("Re-arm a rate-limit-disarmed chat channel (web|telegram) from a distinct surface")
  .action(chatRearmCommand);

const downstreamCmd = program
  .command("downstream")
  .description("Manage downstream MCP servers");
downstreamCmd
  .command("list")
  .description("List configured downstream MCP servers")
  .action(downstreamListCommand);
downstreamCmd
  .command("remove <name>")
  .description("Remove a downstream server from config.yaml")
  .action(downstreamRemoveCommand);
const downstreamAddCmd = downstreamCmd
  .command("add")
  .description("Add and wire up a new downstream MCP server");
downstreamAddCmd
  .command("filesystem <path>")
  .description("Add the @modelcontextprotocol/server-filesystem, rooted at <path>")
  .option("--name <name>", "Server name to register (default: filesystem)")
  .option("--force", "Replace an existing entry with the same name")
  .option("--dry-run", "Show what would be written without touching the config")
  .action(downstreamAddFilesystemCommand);
downstreamAddCmd
  .command("gmail")
  .description("Add @antidrift/mcp-gmail via an interactive OAuth flow")
  .option("--name <name>", "Server name to register (default: gmail)")
  .option("--client-id <id>", "Google OAuth client ID (skips prompt)")
  .option("--client-secret <s>", "Google OAuth client secret (skips prompt)")
  .option("--skip-install", "Don't install the MCP server npm package even if missing")
  .option("--force", "Replace an existing gmail entry")
  .option("--dry-run", "Show what would be written without touching the config")
  .action(downstreamAddGmailCommand);

const policyCmd = program.command("policy").description("Manage Habena policy");
const presetCmd = policyCmd
  .command("preset")
  .description("Manage policy presets (observe, cautious, deny-all)")
  .argument("[name]", "Preset to apply (omit to list)")
  .option("--dry-run", "Print the resulting config without writing")
  .option("--force", "Overwrite existing rules without confirmation")
  .action(async (name: string | undefined, options: { dryRun?: boolean; force?: boolean }) => {
    if (!name) return policyPresetListCommand();
    return policyPresetApplyCommand(name, options);
  });
presetCmd
  .command("show <name>")
  .description("Print the preset's rules without applying")
  .action(policyPresetShowCommand);
presetCmd
  .command("list")
  .description("List available presets")
  .action(policyPresetListCommand);

policyCmd
  .command("explain")
  .description("Trace which rule would match a tool call against the loaded policy")
  .argument("[call]", 'Tool name (e.g. gmail_send) or a full call as JSON, e.g. \'{"tool":"gmail_send","args":{"to":"x"}}\'')
  .option("--tool <name>", "Tool name (alternative to the positional argument)")
  .option("--args <json>", "Tool arguments as JSON")
  .option("--json", "Emit the decision as JSON")
  .action((callJson: string | undefined, opts: { tool?: string; args?: string; json?: boolean }) =>
    policyExplainCommand(callJson, opts)
  );

const packsCmd = program.command("packs").description("Manage rule packs (for use in config.yaml `extends:`)");
packsCmd
  .command("list")
  .description("List available rule packs (shipped + user-authored)")
  .action(packsListCommand);
packsCmd
  .command("show <name>")
  .description("Print the rules inside a pack")
  .action(packsShowCommand);

const securityCmd = program.command("security").description("Policy security checks");
securityCmd
  .command("audit")
  .description("Static analysis over the resolved policy (config.yaml + host-policy.yaml)")
  .option("--json", "Emit findings as JSON; exit code = number of error-severity findings")
  .action(securityAuditCommand);

program
  .command("learn")
  .description("Read the audit log and propose a least-privilege rule set")
  .option("--days <n>", "Observation window in days (default: 14)", "14")
  .option("--agent <name>", "Filter to a specific agent_type")
  .option("--json", "Output observations + suggestions as JSON")
  .option("--write", "Output the suggested rules as YAML (pipe to a file)")
  .action(learnCommand);

program
  .command("doctor")
  .description("Run operational health checks and print a report")
  .option("--only <names>", "Comma-separated check names to run exclusively")
  .option("--skip <names>", "Comma-separated check names to skip")
  .option("--fix", "Attempt auto-fix on failing checks that advertise it")
  .option("--json", "Output JSON instead of human-readable")
  .action(doctorCommand);

const uninstallCmd = program.command("uninstall").description("Remove Habena from an MCP client");
uninstallCmd
  .command("openclaw")
  .description("Restore OpenClaw's previous MCP config from backup")
  .action(uninstallOpenclawCommand);

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
