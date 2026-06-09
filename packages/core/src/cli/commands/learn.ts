import chalk from "chalk";
import { existsSync } from "node:fs";
import { stringify as stringifyYaml } from "yaml";
import { getAuditDbPath } from "../../config/paths.js";
import { observe, propose } from "../../learn/analyzer.js";

interface LearnOptions {
  days?: string;
  agent?: string;
  json?: boolean;
  write?: boolean;
}

export async function learnCommand(options: LearnOptions): Promise<void> {
  const days = options.days ? parseInt(options.days, 10) : 14;
  if (isNaN(days) || days <= 0) {
    console.error(chalk.red("--days must be a positive integer"));
    process.exit(1);
  }

  const dbPath = getAuditDbPath();
  if (!existsSync(dbPath)) {
    console.log(chalk.gray(`No audit DB at ${dbPath} yet.`));
    console.log(chalk.gray("Run `habena start` and send some tool calls first, then come back."));
    return;
  }

  const observations = observe(dbPath, {
    sinceDays: days,
    agentType: options.agent,
  });

  if (observations.length === 0) {
    console.log(chalk.gray(`No tool calls observed in the last ${days} days.`));
    console.log(chalk.gray("Run the proxy with traffic and try again, or widen --days."));
    return;
  }

  const suggestions = propose(observations, { sinceDays: days });

  if (options.json) {
    process.stdout.write(
      JSON.stringify({ observations, suggestions }, null, 2) + "\n"
    );
    return;
  }

  if (options.write) {
    // Emit YAML for the user to redirect into a file:
    //   habena learn --write > proposed.yaml
    process.stdout.write(
      "# Proposed rules (from habena learn)\n" +
        `# Window: last ${days} days, ${observations.length} distinct tool shapes.\n` +
        "# Review before merging into your config.yaml.\n\n"
    );
    process.stdout.write(stringifyYaml({ rules: suggestions.map((s) => s.rule) }));
    return;
  }

  // Human-readable summary
  console.log();
  console.log(chalk.bold(`Observed ${observations.length} tool shapes over the last ${days} days:`));
  console.log();
  const maxTool = Math.max(...observations.map((o) => o.tool.length));
  for (const o of observations.slice(0, 20)) {
    const badge = o.denied > 0
      ? chalk.red(`${o.denied}×deny`)
      : chalk.green(`${o.allowed}×allow`);
    const approv = o.requiredApproval > 0 ? chalk.yellow(` ${o.requiredApproval}×approval`) : "";
    console.log(
      `  ${chalk.cyan(o.tool.padEnd(maxTool + 2))} ${chalk.gray(o.agentType.padEnd(12))} ${o.total} total (${badge}${approv})`
    );
  }
  if (observations.length > 20) {
    console.log(chalk.gray(`  ... and ${observations.length - 20} more`));
  }

  console.log();
  console.log(chalk.bold(`${suggestions.length} rule suggestion${suggestions.length === 1 ? "" : "s"}:`));
  if (suggestions.length === 0) {
    console.log(chalk.gray("  (not enough signal yet — let the agent run longer, or lower --days)"));
    return;
  }
  console.log();
  for (const s of suggestions.slice(0, 15)) {
    const act = s.rule.action;
    const color =
      act === "allow" ? chalk.green :
      act === "deny" ? chalk.red :
      chalk.yellow;
    console.log(`  ${color(act.padEnd(18))} ${chalk.cyan(s.rule.match.tool ?? "?")}`);
    console.log(`    ${chalk.gray(s.rationale)}`);
  }
  if (suggestions.length > 15) {
    console.log(chalk.gray(`  ... and ${suggestions.length - 15} more`));
  }
  console.log();
  console.log(chalk.gray("  Write the suggested rules as YAML:  habena learn --write > proposed.yaml"));
  console.log(chalk.gray("  Review and merge into:             ~/.habena/config.yaml"));
}
