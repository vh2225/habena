import chalk from "chalk";
import { getAuditDbPath } from "../../config/paths.js";
import { AuditLogger } from "../../audit/logger.js";
import type { AuditQueryFilters } from "../../audit/types.js";

function parseDuration(duration: string): Date {
  const match = duration.match(/^(\d+)(h|d)$/);
  if (!match) {
    throw new Error(`Invalid duration: ${duration} (use formats like 24h, 7d)`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const ms = unit === "h" ? value * 60 * 60 * 1000 : value * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

export async function logsCommand(options: {
  agent?: string;
  last?: string;
  decision?: string;
  limit?: string;
}): Promise<void> {
  const audit = new AuditLogger(getAuditDbPath());

  const filters: AuditQueryFilters = {};
  if (options.agent) filters.agentType = options.agent;
  if (options.last) filters.since = parseDuration(options.last);
  if (options.decision) {
    if (!["allow", "deny", "require_approval"].includes(options.decision)) {
      console.error(chalk.red(`Invalid decision: ${options.decision}`));
      process.exit(1);
    }
    filters.decision = options.decision as "allow" | "deny" | "require_approval";
  }
  filters.limit = options.limit ? parseInt(options.limit, 10) : 50;

  const entries = audit.query(filters);

  if (entries.length === 0) {
    console.log(chalk.yellow("No audit entries match the filters."));
    audit.close();
    return;
  }

  for (const entry of entries) {
    const ts = entry.timestamp.toISOString().replace("T", " ").slice(0, 19);
    const color =
      entry.decision === "allow"
        ? chalk.green
        : entry.decision === "deny"
        ? chalk.red
        : chalk.yellow;
    const decisionTag = color(`[${entry.decision.toUpperCase()}]`);
    const cost = entry.cost !== null ? `$${entry.cost.toFixed(4)}` : "-";
    console.log(
      `${chalk.gray(ts)}  ${decisionTag}  ${chalk.cyan(entry.agentType)}  ${entry.tool}  ${chalk.gray(cost)}`
    );
    if (entry.reason) {
      console.log(`  ${chalk.gray(entry.reason)}`);
    }
  }

  console.log(chalk.gray(`\n${entries.length} entries`));
  audit.close();
}
