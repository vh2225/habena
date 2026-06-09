import chalk from "chalk";
import inquirer from "inquirer";
import { addFilesystemServer } from "../../downstream-add/filesystem.js";
import { addGmailServer, type Prompter } from "../../downstream-add/gmail.js";
import { listDownstreamServers, removeDownstreamServer } from "../../downstream-add/installer.js";

// ---- list ----

export async function downstreamListCommand(): Promise<void> {
  const servers = listDownstreamServers();
  const names = Object.keys(servers);
  if (names.length === 0) {
    console.log(chalk.gray("No downstream MCP servers configured yet."));
    console.log(chalk.gray("Add one: habena downstream add <type>"));
    return;
  }
  console.log();
  console.log(chalk.bold("Configured downstream MCP servers:\n"));
  const maxName = Math.max(...names.map((n) => n.length));
  for (const name of names) {
    const s = servers[name];
    const auth = s.auth_probe ? chalk.gray(` (probe: ${s.auth_probe.tool})`) : "";
    console.log(`  ${chalk.cyan(name.padEnd(maxName + 2))} ${s.command} ${(s.args ?? []).join(" ")}${auth}`);
  }
  console.log();
}

// ---- remove ----

export async function downstreamRemoveCommand(name: string): Promise<void> {
  const existed = removeDownstreamServer(name);
  if (!existed) {
    console.log(chalk.yellow(`! No server named "${name}" in config.yaml`));
    process.exit(1);
  }
  console.log(chalk.green(`✓ Removed "${name}" from config.yaml (backup saved alongside)`));
}

// ---- add filesystem ----

export async function downstreamAddFilesystemCommand(
  path: string,
  options: { name?: string; force?: boolean; dryRun?: boolean }
): Promise<void> {
  try {
    const result = await addFilesystemServer({ path, name: options.name }, options);
    if (!result.wrote) {
      console.log(chalk.cyan(`[dry run] Would register "${result.name}" pointing at ${path}`));
      return;
    }
    console.log(chalk.green(`✓ Added "${result.name}" (filesystem server at ${path})`));
    if (result.backupPath) console.log(chalk.gray(`  Backup: ${result.backupPath}`));
    console.log(chalk.cyan(`\nNext: restart the proxy so the new server shows up in tools/list.`));
  } catch (err) {
    console.error(chalk.red(`✗ Add failed: ${(err as Error).message}`));
    process.exit(1);
  }
}

// ---- add gmail ----

const cliPrompter: Prompter = {
  async getClientCredentials() {
    console.log(chalk.cyan("\nGoogle OAuth client credentials needed."));
    console.log(
      chalk.gray("  (Console → APIs & Services → Credentials → Desktop app → Download JSON → paste values below)")
    );
    const answers = await inquirer.prompt([
      { type: "input", name: "client_id", message: "Client ID:" },
      { type: "password", name: "client_secret", message: "Client secret:", mask: "*" },
    ]);
    return { client_id: String(answers.client_id), client_secret: String(answers.client_secret) };
  },
  async getAuthCode(authUrl: string) {
    console.log(chalk.cyan("\nAuthorize Habena in your browser."));
    console.log(chalk.gray("\n  1. Open this URL in any browser:\n"));
    console.log(`     ${authUrl}`);
    console.log(chalk.gray("\n  2. Grant the Gmail + profile scopes."));
    console.log(chalk.gray("  3. Google will redirect to a page that can't load — that's expected."));
    console.log(chalk.gray("  4. Copy the full URL from your browser's address bar and paste below."));
    console.log();
    const { code } = await inquirer.prompt([
      { type: "input", name: "code", message: "Paste the redirect URL (or just the code=...):" },
    ]);
    return String(code);
  },
  async confirmNpmInstall(pkg: string) {
    const { ok } = await inquirer.prompt([
      { type: "confirm", name: "ok", message: `Install ${pkg} globally via npm? (needed for the Gmail MCP server)`, default: true },
    ]);
    return Boolean(ok);
  },
};

export async function downstreamAddGmailCommand(
  options: {
    name?: string;
    clientId?: string;
    clientSecret?: string;
    skipInstall?: boolean;
    force?: boolean;
    dryRun?: boolean;
  }
): Promise<void> {
  try {
    const result = await addGmailServer(
      {
        name: options.name,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        skipInstall: options.skipInstall,
      },
      cliPrompter,
      { force: options.force, dryRun: options.dryRun }
    );
    if (!result.wrote) {
      console.log(chalk.cyan(`[dry run] Would register "${result.name}" with auth token at ${result.tokenPath}`));
      return;
    }
    console.log(chalk.green(`\n✓ Added "${result.name}" (Gmail MCP)`));
    console.log(chalk.gray(`  Credentials: ${result.clientPath}`));
    console.log(chalk.gray(`  Token:       ${result.tokenPath}`));
    console.log(chalk.gray(`  Scopes:      ${result.scopesGranted}`));
    if (result.backupPath) console.log(chalk.gray(`  Backup:      ${result.backupPath}`));
    console.log(chalk.cyan(`\nNext: restart the proxy so the new server shows up in tools/list.`));
  } catch (err) {
    console.error(chalk.red(`\n✗ Add failed: ${(err as Error).message}`));
    process.exit(1);
  }
}
