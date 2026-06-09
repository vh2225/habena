import chalk from "chalk";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installOpenclaw, uninstallOpenclaw } from "../../install/openclaw.js";

function resolveAgentguardBinary(): string {
  // Resolve the absolute path of dist/cli/index.js relative to this module
  // When running from dist/, __filename lives in dist/cli/commands/ — so the entrypoint is ../index.js
  const currentFile = fileURLToPath(import.meta.url);
  // currentFile = .../dist/cli/commands/install.js → entrypoint = .../dist/cli/index.js
  return join(dirname(currentFile), "..", "index.js");
}

export async function installOpenclawCommand(options: {
  dryRun?: boolean;
  force?: boolean;
}): Promise<void> {
  const binary = resolveAgentguardBinary();
  console.log(chalk.gray(`Habena binary: ${binary}`));

  // Sanity check: the absolute path we're about to write into OpenClaw's
  // config must actually exist. Prevents the class of bug where we
  // install from a temp location or from a package that later gets
  // upgraded to a different path, leaving openclaw.json pointing at a
  // dead file. Doctor catches this post-hoc; install should prevent it.
  if (!existsSync(binary)) {
    console.error(chalk.red(`✗ Install aborted: computed binary path does not exist: ${binary}`));
    console.error(chalk.gray("  This usually means the module is being imported from a stale or moved install."));
    process.exit(1);
  }

  try {
    const result = await installOpenclaw({
      agentguardBinaryPath: binary,
      dryRun: options.dryRun,
      force: options.force,
    });

    if (options.dryRun) {
      console.log(chalk.cyan("\n[dry run] Would perform the following:"));
    } else {
      console.log(chalk.green("\n✓ Installed Habena into OpenClaw"));
    }

    console.log(chalk.gray(`  OpenClaw config: ${result.openclawConfigPath}`));
    console.log(chalk.gray(`  Habena config: ${result.agentguardConfigPath}`));
    if (result.backupPath) {
      console.log(chalk.gray(`  Backup saved: ${result.backupPath}`));
    }
    console.log(chalk.gray(`  Migrated ${result.migratedServers.length} MCP server(s):`));
    for (const name of result.migratedServers) {
      console.log(chalk.gray(`    • ${name}`));
    }

    if (!options.dryRun) {
      console.log(chalk.cyan("\nNext steps:"));
      console.log("  1. Start the approval watcher in another terminal:");
      console.log(chalk.bold("     habena watch"));
      console.log("  2. Restart OpenClaw's gateway to pick up the new config:");
      console.log(chalk.bold("     openclaw gateway restart"));
      console.log("  3. Send OpenClaw a task and watch approvals flow.");
      console.log(chalk.gray("\n  To undo: habena uninstall openclaw"));
    }
  } catch (err) {
    console.error(chalk.red(`\n✗ Install failed: ${(err as Error).message}`));
    process.exit(1);
  }
}

export async function uninstallOpenclawCommand(): Promise<void> {
  try {
    const result = await uninstallOpenclaw({});
    if (result.restored) {
      console.log(chalk.green(`✓ Restored OpenClaw config from ${result.restoredFrom}`));
      console.log(chalk.cyan("\nDon't forget to restart OpenClaw's gateway:"));
      console.log(chalk.bold("  openclaw gateway restart"));
    } else {
      console.log(chalk.yellow("Nothing to restore."));
    }
  } catch (err) {
    console.error(chalk.red(`✗ Uninstall failed: ${(err as Error).message}`));
    process.exit(1);
  }
}
