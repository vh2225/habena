import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import { getConfigDir } from "../../config/paths.js";
import { encode, decodeLines, type ServerMessage, type SerializedPendingApproval } from "../../ipc/protocol.js";

const SOCKET_FILE = "agentguard.sock";

export async function watchCommand(): Promise<void> {
  const socketPath = join(getConfigDir(), SOCKET_FILE);
  if (!existsSync(socketPath)) {
    console.error(chalk.red(`Socket not found: ${socketPath}`));
    console.error(chalk.gray("Is Habena running? Try: habena start"));
    process.exit(1);
  }

  const socket = createConnection(socketPath);
  const pendingQueue: SerializedPendingApproval[] = [];
  let processing = false;

  socket.on("connect", () => {
    console.log(chalk.green(`Connected to Habena (${socketPath})`));
    console.log(chalk.gray("Watching for approval requests…\n"));
  });

  socket.on("error", (err) => {
    console.error(chalk.red(`Socket error: ${err.message}`));
    process.exit(1);
  });

  socket.on("close", () => {
    console.log(chalk.yellow("\nDisconnected from Habena."));
    process.exit(0);
  });

  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    const { messages, remainder } = decodeLines(buffer);
    buffer = remainder;
    for (const raw of messages) {
      const msg = raw as ServerMessage;
      if (msg.type === "hello") {
        console.log(chalk.gray(`Server version: ${msg.version}`));
      } else if (msg.type === "approval_request") {
        pendingQueue.push(msg.pending);
        if (!processing) {
          processing = true;
          void processNext(socket, pendingQueue, () => {
            processing = false;
          });
        }
      }
    }
  });

  process.on("SIGINT", () => {
    console.log(chalk.yellow("\nShutting down watcher…"));
    socket.end();
    process.exit(0);
  });
}

async function processNext(
  socket: Socket,
  queue: SerializedPendingApproval[],
  done: () => void
): Promise<void> {
  while (queue.length > 0) {
    const next = queue.shift()!;
    renderRequest(next);

    const { choice } = await inquirer.prompt<{ choice: string }>([
      {
        type: "list",
        name: "choice",
        message: "What would you like to do?",
        choices: [
          { name: "Allow once", value: "allow_once" },
          { name: "Allow similar for 1 hour", value: "allow_session_1h" },
          { name: "Allow similar for this session (8h)", value: "allow_session_8h" },
          { name: "Deny", value: "deny" },
        ],
      },
    ]);

    let response;
    switch (choice) {
      case "allow_once":
        response = { type: "respond" as const, id: next.id, choice: "allow_once" as const };
        break;
      case "allow_session_1h":
        response = {
          type: "respond" as const,
          id: next.id,
          choice: "allow_session" as const,
          durationMs: 60 * 60 * 1000,
        };
        break;
      case "allow_session_8h":
        response = {
          type: "respond" as const,
          id: next.id,
          choice: "allow_session" as const,
          durationMs: 8 * 60 * 60 * 1000,
        };
        break;
      case "deny":
      default:
        response = { type: "respond" as const, id: next.id, choice: "deny" as const };
        break;
    }

    socket.write(encode(response));
    console.log(chalk.gray(`→ sent: ${choice}\n`));
  }
  done();
}

function renderRequest(p: SerializedPendingApproval): void {
  const expiresAt = new Date(p.expiresAt);
  const secondsLeft = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  console.log(chalk.bold.yellow("🔔 APPROVAL NEEDED"));
  console.log(`  Agent:    ${chalk.cyan(p.agentType)} (${chalk.gray(p.instanceId)})`);
  console.log(`  Tool:     ${chalk.magenta(p.tool)}`);
  console.log(`  Args:     ${chalk.gray(JSON.stringify(p.args))}`);
  console.log(`  Reason:   ${chalk.yellow(p.reason)}`);
  console.log(`  Cost:     ${chalk.gray(`$${p.estimatedCost.toFixed(4)}`)}`);
  console.log(`  Expires:  ${chalk.gray(`${minutes}m ${seconds}s`)}`);
  console.log();
}
