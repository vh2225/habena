import chalk from "chalk";
import { stringify as stringifyYaml } from "yaml";
import { listPacks, getPack, packSearchDirs } from "../../policy/packs.js";

export async function packsListCommand(): Promise<void> {
  const packs = listPacks();
  if (packs.length === 0) {
    console.log(chalk.gray("No rule packs found."));
    console.log(chalk.gray(`Search dirs: ${packSearchDirs().join(", ")}`));
    return;
  }
  console.log();
  console.log(chalk.bold(`${packs.length} rule pack${packs.length === 1 ? "" : "s"} available:`));
  console.log();
  const maxName = Math.max(...packs.map((p) => p.name.length));
  for (const p of packs) {
    const serverTag = p.server ? chalk.gray(`[${p.server}]`) : "";
    console.log(`  ${chalk.cyan(p.name.padEnd(maxName + 2))} ${serverTag}`);
    if (p.description) {
      console.log(`    ${chalk.gray(p.description)}`);
    }
  }
  console.log();
  console.log(chalk.gray("Import into your config.yaml:"));
  console.log(chalk.gray("  extends:"));
  console.log(chalk.gray("    - gmail-readonly"));
  console.log(chalk.gray("    - filesystem-write-approval"));
  console.log();
}

export async function packsShowCommand(name: string): Promise<void> {
  const pack = getPack(name);
  if (!pack) {
    console.error(chalk.red(`✗ Unknown pack: ${name}`));
    console.error(chalk.gray(`Run \`agentguard packs list\` to see available packs.`));
    process.exit(1);
  }
  console.log();
  console.log(chalk.bold(`Pack: ${pack.name}`));
  if (pack.description) console.log(chalk.gray(pack.description));
  if (pack.server) console.log(chalk.gray(`Target server: ${pack.server}`));
  console.log(chalk.gray(`Source: ${pack.source}`));
  console.log();
  console.log(chalk.bold("rules:"));
  console.log(stringifyYaml({ rules: pack.rules }));
}
