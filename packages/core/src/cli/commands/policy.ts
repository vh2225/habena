import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { stringify as stringifyYaml } from "yaml";
import { getConfigPath } from "../../config/paths.js";
import { loadYaml, loadConfigWithPacks, loadHostPolicy } from "../../config/loader.js";
import type { AgentGuardConfig } from "../../policy/types.js";
import { PRESETS, listPresets, applyPreset, getPreset } from "../../policy/presets.js";
import { PolicyEngine } from "../../policy/engine.js";
import type { ToolCallContext } from "../../policy/matcher.js";

interface PresetOptions {
  dryRun?: boolean;
  force?: boolean;
}

export async function policyPresetListCommand(): Promise<void> {
  console.log(chalk.bold("\nAvailable policy presets:\n"));
  for (const p of listPresets()) {
    console.log(`  ${chalk.cyan(p.name.padEnd(12))} ${chalk.gray(p.description)}`);
  }
  console.log();
  console.log(chalk.gray("Apply with:  agentguard policy preset <name>"));
  console.log(chalk.gray("Preview:     agentguard policy preset <name> --dry-run"));
  console.log();
}

export async function policyPresetShowCommand(presetName: string): Promise<void> {
  const preset = getPreset(presetName);
  if (!preset) {
    printUnknownPreset(presetName);
    process.exit(1);
  }
  console.log(chalk.bold(`\nPreset: ${preset.name}`));
  console.log(chalk.gray(preset.description));
  console.log();
  console.log(chalk.bold("rules:"));
  console.log(stringifyYaml({ rules: preset.rules }));
}

export async function policyPresetApplyCommand(
  presetName: string,
  options: PresetOptions
): Promise<void> {
  const preset = getPreset(presetName);
  if (!preset) {
    printUnknownPreset(presetName);
    process.exit(1);
  }

  const configPath = getConfigPath();
  const existing = loadYaml<AgentGuardConfig>(configPath) ?? {};
  const updated = applyPreset(existing, preset);

  const yaml = stringifyYaml(updated);

  if (options.dryRun) {
    console.log(chalk.cyan(`\n[dry run] Would write to ${configPath}:\n`));
    console.log(yaml);
    return;
  }

  // If the file exists AND has non-empty rules AND --force isn't set, warn.
  if (
    existsSync(configPath) &&
    existing.rules &&
    existing.rules.length > 0 &&
    !options.force
  ) {
    console.error(chalk.yellow(`✗ Refusing to overwrite existing rules in ${configPath}`));
    console.error(
      chalk.gray(
        `  ${existing.rules.length} existing rule(s) would be replaced. Re-run with --force to proceed,`
      )
    );
    console.error(chalk.gray(`  or --dry-run to preview the change.`));
    console.error(
      chalk.gray(`  A backup will be saved alongside the config as config.yaml.backup-<timestamp>.`)
    );
    process.exit(1);
  }

  // Backup existing config before overwriting.
  if (existsSync(configPath)) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${configPath}.backup-${ts}`;
    copyFileSync(configPath, backupPath);
    console.log(chalk.gray(`Backup: ${backupPath}`));
  }

  writeFileSync(configPath, yaml, { mode: 0o600 });
  console.log(chalk.green(`✓ Applied preset "${preset.name}" to ${configPath}`));
  console.log(chalk.gray(`  ${preset.rules.length} rules written`));
  console.log(chalk.cyan(`\nNext: restart the proxy so the new rules take effect.`));
}

function printUnknownPreset(name: string): void {
  console.error(chalk.red(`✗ Unknown preset: ${name}`));
  console.error(chalk.gray(`  Available: ${Object.keys(PRESETS).join(", ")}`));
}

/**
 * `agentguard policy explain` — given a tool-call shape (as JSON or via
 * `--tool`/`--args`), run the real loaded policy engine against it and
 * print the decision with the rule that matched. Zero side effects, no
 * proxy connection needed — reads the same config.yaml + host-policy.yaml
 * the proxy would at startup. Useful for:
 *   - debugging why a user's call is being denied / approved
 *   - pre-flighting a new rule before restarting the proxy
 *   - verifying the host-policy floor is behaving as intended
 */
export async function policyExplainCommand(
  callJson: string | undefined,
  options: { tool?: string; args?: string; json?: boolean }
): Promise<void> {
  let call: ToolCallContext;
  try {
    call = parseCallInput(callJson, options);
  } catch (err) {
    console.error(chalk.red(`✗ ${(err as Error).message}`));
    console.error(
      chalk.gray(
        `Usage: agentguard policy explain '{"tool":"gmail_send","args":{"to":"x@y"}}'\n` +
          `       agentguard policy explain --tool gmail_send --args '{"to":"x@y"}'`
      )
    );
    process.exit(1);
  }

  const { config, missingPacks } = loadConfigWithPacks(getConfigPath());
  const host = loadHostPolicy();
  if (missingPacks.length > 0) {
    console.error(
      chalk.yellow(`! extends: could not resolve pack(s): ${missingPacks.join(", ")} — continuing without`)
    );
  }
  if (host.missingPacks.length > 0) {
    console.error(
      chalk.yellow(`! host-policy extends: missing pack(s): ${host.missingPacks.join(", ")}`)
    );
  }

  const engine = new PolicyEngine(config.rules ?? [], host.rules);
  const decision = engine.evaluate(call);

  if (options.json) {
    process.stdout.write(JSON.stringify({ call, decision }, null, 2) + "\n");
    return;
  }

  console.log();
  console.log(chalk.bold(`Tool call`));
  console.log(`  tool:   ${chalk.cyan(call.tool)}`);
  if (call.args && Object.keys(call.args).length > 0) {
    console.log(`  args:   ${chalk.gray(JSON.stringify(call.args))}`);
  }
  console.log();
  console.log(chalk.bold(`Decision`));
  const color =
    decision.action === "allow"
      ? chalk.green
      : decision.action === "deny"
      ? chalk.red
      : chalk.yellow;
  console.log(`  action:       ${color(decision.action)}`);
  console.log(`  tier:         ${decision.tier}`);
  console.log(`  enforcement:  ${decision.enforcement}`);
  console.log(`  reason:       ${decision.reason}`);
  if (decision.rule_matched) {
    console.log(`  rule:         ${decision.rule_matched}`);
  }
  console.log();

  const hostCount = host.rules.length;
  const userCount = (config.rules ?? []).length;
  console.log(
    chalk.gray(
      `Evaluated against ${userCount} user rule${userCount === 1 ? "" : "s"} + ` +
        `${hostCount} host-policy floor rule${hostCount === 1 ? "" : "s"}.`
    )
  );
  if (decision.tier === "built_in" && decision.action === "deny" && decision.reason.includes("implicit deny")) {
    console.log(
      chalk.gray(
        `No explicit rule matched. The engine's implicit-deny fail-safe blocked the call.`
      )
    );
  }
  console.log();
}

function parseCallInput(
  positional: string | undefined,
  options: { tool?: string; args?: string }
): ToolCallContext {
  if (positional) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(positional);
    } catch {
      throw new Error(`Argument is not valid JSON: ${positional.slice(0, 80)}`);
    }
    if (!parsed || typeof parsed !== "object" || typeof (parsed as { tool?: unknown }).tool !== "string") {
      throw new Error(`JSON must include a string "tool" field`);
    }
    const obj = parsed as { tool: string; args?: unknown; mcp_server?: unknown };
    return {
      tool: obj.tool,
      args: (obj.args ?? {}) as Record<string, unknown>,
      mcp_server: typeof obj.mcp_server === "string" ? obj.mcp_server : undefined,
    };
  }
  if (!options.tool) {
    throw new Error(`Provide a JSON argument or --tool <name> [--args <json>]`);
  }
  let args: Record<string, unknown> = {};
  if (options.args) {
    try {
      args = JSON.parse(options.args) as Record<string, unknown>;
    } catch {
      throw new Error(`--args is not valid JSON: ${options.args.slice(0, 80)}`);
    }
  }
  return { tool: options.tool, args };
}
