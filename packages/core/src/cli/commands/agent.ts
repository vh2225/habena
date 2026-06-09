import chalk from "chalk";
import { getAgentsPath } from "../../config/paths.js";
import { AgentRegistry } from "../../identity/registry.js";
import type { AgentType } from "../../identity/types.js";

function generateFingerprint(name: string): string {
  return `${name}-${Date.now().toString(36)}`;
}

export async function agentAddCommand(options: {
  name: string;
  budgetDaily?: number;
  budgetPerSession?: number;
  from?: string;
}): Promise<void> {
  const registry = new AgentRegistry(getAgentsPath());

  if (options.from) {
    const variant = registry.createVariant(options.name, options.from, {
      budget: {
        daily: options.budgetDaily,
        per_session: options.budgetPerSession,
      },
    });
    registry.save();
    console.log(chalk.green(`✓ Created variant "${options.name}" from "${options.from}"`));
    console.log(`  Fingerprint: ${variant.fingerprint}`);
    return;
  }

  const agent: AgentType = {
    name: options.name,
    fingerprint: generateFingerprint(options.name),
    registered: new Date().toISOString().split("T")[0],
    mode: "enforced",
    permissions: {
      budget: {
        daily: options.budgetDaily,
        per_session: options.budgetPerSession,
      },
    },
  };

  registry.register(agent);
  registry.save();
  console.log(chalk.green(`✓ Registered agent "${options.name}"`));
  console.log(`  Fingerprint: ${agent.fingerprint}`);
  console.log(`  Daily budget: $${options.budgetDaily ?? "unset"}`);
}

export async function agentListCommand(): Promise<void> {
  const registry = new AgentRegistry(getAgentsPath());
  const agents = registry.list();

  if (agents.length === 0) {
    console.log(chalk.yellow("No agents registered."));
    console.log("Add one with: habena agent add --name <name> --budget-daily <amount>");
    return;
  }

  console.log(chalk.bold("\nRegistered agents:\n"));
  const nameWidth = Math.max(...agents.map((a) => a.name.length), 10);
  console.log(
    `  ${"NAME".padEnd(nameWidth)}  ${"MODE".padEnd(10)}  ${"BUDGET".padEnd(12)}  FINGERPRINT`
  );
  for (const agent of agents) {
    const budget = agent.permissions.budget?.daily
      ? `$${agent.permissions.budget.daily}/day`
      : "none";
    console.log(
      `  ${agent.name.padEnd(nameWidth)}  ${agent.mode.padEnd(10)}  ${budget.padEnd(12)}  ${agent.fingerprint}`
    );
  }
  console.log();
}
