import chalk from "chalk";
import { IpcClient } from "../../ipc/client.js";
import type { ClientMessage, ServerMessage } from "../../ipc/protocol.js";

/**
 * habena chat status         — show bridge/run/disarmed/queue state
 * habena chat rearm <channel> — re-arm a rate-limit-tripped channel from a
 *                                distinct surface (Phase 7 circuit-breaker
 *                                requirement: rearm can't be the same
 *                                surface that got disarmed).
 */

const VALID_CHANNELS = new Set(["web", "telegram"]);
const KNOWN_CHANNELS = ["web", "telegram"] as const;

/**
 * One-shot request/response against the proxy's IPC socket. Mirrors the
 * `request<T>` helper in session.ts: resolves on the expected reply type,
 * rejects if the server answers `error` (e.g. "chat disabled"), and lets
 * `connect()` failures (proxy not running) propagate to the caller's catch.
 */
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

export async function chatStatusCommand(): Promise<void> {
  try {
    const result = await request({ type: "chat_status" }, "chat_status_result");
    console.log(`bridge: ${result.bridgeUp ? chalk.green("up") : chalk.red("down")}`);
    console.log(`state:  ${result.running ? "running" : "idle"}`);
    for (const channel of KNOWN_CHANNELS) {
      if (result.disarmed.includes(channel)) {
        console.log(`${channel}: ${chalk.red.bold("DISARMED")}`);
      } else {
        console.log(`${channel}: ${chalk.green("armed")}`);
      }
    }
    console.log(`queue depth: ${result.queueDepth}`);
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}

export async function chatRearmCommand(channel: string): Promise<void> {
  if (!VALID_CHANNELS.has(channel)) {
    console.error(chalk.red(`Invalid channel: ${channel}`));
    console.error(chalk.gray(`Use one of: web, telegram`));
    process.exit(1);
  }

  try {
    const ack = await request({ type: "chat_rearm", channel: channel as "web" | "telegram" }, "chat_ack");
    if (!ack.ok) {
      console.error(chalk.red(`✗ Server rejected rearm${ack.reason ? ": " + ack.reason : ""}`));
      process.exit(1);
    }
    console.log(chalk.green(`✓ Re-armed ${channel}`));
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}
