import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import chalk from "chalk";
import { getConfigDir, getConfigPath, getAgentsPath } from "../../config/paths.js";

const DEFAULT_CONFIG = `# AgentGuard configuration
budget:
  daily: 50
  monthly: 500
  per_session: 20
  per_request: 5
  alert_at: [50, 80]
  on_exceed: deny

rules:
  # Block destructive shell commands
  - match:
      tool: "shell_*"
      args_contain: ["rm -rf", "DROP TABLE"]
    action: deny
    enforcement: hard_mandatory
    reason: "Destructive command blocked"

  # Require approval for outbound communications
  - match:
      tool_tag: communication
    action: require_approval
    enforcement: soft_mandatory
    reason: "Outbound communication"

  # Allow everything else
  - match:
      tool: "*"
    action: allow
`;

const DEFAULT_AGENTS = `# Registered agents
# Add agents with: agentguard agent add --name <name> --budget-daily <amount>
agents: {}
`;

export async function initCommand(options: { force?: boolean } = {}): Promise<void> {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(chalk.green(`✓ Created ${dir}`));
  }

  const configPath = getConfigPath();
  if (existsSync(configPath) && !options.force) {
    console.log(chalk.yellow(`! ${configPath} already exists (use --force to overwrite)`));
  } else {
    writeFileSync(configPath, DEFAULT_CONFIG, "utf8");
    console.log(chalk.green(`✓ Created ${configPath}`));
  }

  const agentsPath = getAgentsPath();
  if (existsSync(agentsPath) && !options.force) {
    console.log(chalk.yellow(`! ${agentsPath} already exists (use --force to overwrite)`));
  } else {
    writeFileSync(agentsPath, DEFAULT_AGENTS, "utf8");
    console.log(chalk.green(`✓ Created ${agentsPath}`));
  }

  console.log(chalk.cyan("\nNext steps:"));
  console.log("  agentguard agent add --name openclaw --budget-daily 30");
  console.log("  agentguard start");
}
