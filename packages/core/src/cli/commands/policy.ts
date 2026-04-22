import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { stringify as stringifyYaml } from "yaml";
import { getConfigPath } from "../../config/paths.js";
import { loadYaml } from "../../config/loader.js";
import type { AgentGuardConfig } from "../../policy/types.js";
import { PRESETS, listPresets, applyPreset, getPreset } from "../../policy/presets.js";

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
