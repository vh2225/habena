import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { stringify as stringifyYaml } from "yaml";
import chalk from "chalk";
import { getConfigDir, getConfigPath, getAgentsPath } from "../../config/paths.js";
import { getPreset } from "../../policy/presets.js";
import type { AgentGuardConfig } from "../../policy/types.js";

function buildDefaultConfig(): string {
  const cautious = getPreset("cautious")!;
  const config: AgentGuardConfig = {
    budget: {
      daily: 50,
      monthly: 500,
      per_session: 20,
      per_request: 5,
      alert_at: [50, 80],
      on_exceed: "deny",
    },
    rules: cautious.rules,
  };
  // Inline header that explains the posture choice.
  const header = [
    "# Habena configuration — initialized with the `cautious` preset.",
    "#",
    "# Read/list tools are allowed. Writes require approval. Destructive tools",
    "# are hard-denied. Unknown tools fall through to require_approval.",
    "#",
    "# Change postures any time with:   habena policy preset <name>",
    "# Preview first:                    habena policy preset <name> --dry-run",
    "",
  ].join("\n");
  return header + stringifyYaml(config);
}

const DEFAULT_AGENTS = `# Registered agents
# Add agents with: habena agent add --name <name> --budget-daily <amount>
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
    writeFileSync(configPath, buildDefaultConfig(), "utf8");
    console.log(chalk.green(`✓ Created ${configPath} (preset: cautious)`));
  }

  const agentsPath = getAgentsPath();
  if (existsSync(agentsPath) && !options.force) {
    console.log(chalk.yellow(`! ${agentsPath} already exists (use --force to overwrite)`));
  } else {
    writeFileSync(agentsPath, DEFAULT_AGENTS, "utf8");
    console.log(chalk.green(`✓ Created ${agentsPath}`));
  }

  console.log(chalk.cyan("\nNext steps:"));
  console.log("  habena agent add --name openclaw --budget-daily 30");
  console.log("  habena start");
}
