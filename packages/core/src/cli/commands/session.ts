import chalk from "chalk";
import { IpcClient } from "../../ipc/client.js";
import type { ClientMessage, ServerMessage, SerializedOverride } from "../../ipc/protocol.js";

/**
 * Operator controls for the running proxy:
 *   habena lockdown on|off|status   — panic button (deny everything)
 *   habena session list             — active allow_session grants
 *   habena session revoke <id>     — kill a grant before it expires
 */

/** One-shot request/response against the proxy's IPC socket. */
async function request<T extends ServerMessage["type"]>(
  msg: ClientMessage,
  expect: T,
  timeoutMs = 2000
): Promise<Extract<ServerMessage, { type: T }>> {
  const client = new IpcClient();
  await client.connect();
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${expect}`)), timeoutMs);
      client.onMessage((m) => {
        if (m.type === expect) {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { type: T }>);
        } else if (m.type === "error") {
          clearTimeout(timer);
          reject(new Error(m.message));
        }
      });
      client.send(msg);
    });
  } finally {
    client.close();
  }
}

export async function lockdownCommand(state: string | undefined): Promise<void> {
  try {
    if (state === "on" || state === "off") {
      const ack = await request({ type: "set_lockdown", on: state === "on" }, "lockdown_ack");
      if (ack.on) {
        console.log(chalk.red.bold("🔒 LOCKDOWN ACTIVE — every tool call is denied."));
        console.log(chalk.gray("   Release with: habena lockdown off"));
      } else {
        console.log(chalk.green("🔓 Lockdown released — policy enforcement resumes normally."));
      }
      return;
    }
    if (state !== undefined && state !== "status") {
      console.error(chalk.red(`Unknown state: ${state} (use on | off | status)`));
      process.exit(1);
    }
    const list = await request({ type: "list_overrides" }, "overrides_list");
    console.log(
      list.lockdown
        ? chalk.red.bold("🔒 LOCKDOWN ACTIVE — every tool call is denied.")
        : chalk.green("🔓 No lockdown — policy enforcement is normal.")
    );
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    console.error(chalk.gray("Is the proxy running? Try: habena start"));
    process.exit(1);
  }
}

function printOverrides(overrides: SerializedOverride[]): void {
  if (overrides.length === 0) {
    console.log(chalk.gray("No active session approvals."));
    return;
  }
  console.log();
  console.log(chalk.bold(`${overrides.length} active session approval${overrides.length > 1 ? "s" : ""}:\n`));
  for (const o of overrides) {
    const secondsLeft = Math.max(0, Math.floor((new Date(o.expiresAt).getTime() - Date.now()) / 1000));
    console.log(`  ${chalk.cyan(o.id)}`);
    console.log(`    tool:    ${chalk.magenta(o.tool)}`);
    console.log(`    reason:  ${o.reason}`);
    console.log(`    expires: ${Math.floor(secondsLeft / 60)}m ${secondsLeft % 60}s`);
    console.log();
  }
  console.log(chalk.gray("Revoke early with: habena session revoke <id>"));
}

export async function sessionListCommand(options: { json?: boolean }): Promise<void> {
  try {
    const list = await request({ type: "list_overrides" }, "overrides_list");
    if (options.json) {
      process.stdout.write(JSON.stringify({ lockdown: list.lockdown, overrides: list.overrides }, null, 2) + "\n");
      return;
    }
    if (list.lockdown) console.log(chalk.red.bold("🔒 LOCKDOWN ACTIVE\n"));
    printOverrides(list.overrides);
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    console.error(chalk.gray("Is the proxy running? Try: habena start"));
    process.exit(1);
  }
}

export async function sessionRevokeCommand(id: string): Promise<void> {
  try {
    const ack = await request({ type: "revoke_override", id }, "revoke_ack");
    if (ack.ok) {
      console.log(chalk.green(`✓ Revoked session approval ${id} — matching calls need approval again.`));
    } else {
      console.error(chalk.red(`✗ Unknown session approval id: ${id} (already expired or revoked?)`));
      process.exit(1);
    }
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    console.error(chalk.gray("Is the proxy running? Try: habena start"));
    process.exit(1);
  }
}
