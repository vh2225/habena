import { createHmac } from "node:crypto";
import chalk from "chalk";
import { IpcClient, socketPath } from "../../ipc/client.js";
import type { ServerMessage } from "../../ipc/protocol.js";

// ---- approvals list ----

export async function approvalsListCommand(options: { json?: boolean }): Promise<void> {
  const client = new IpcClient();
  try {
    const pending = await client.listPending();
    if (options.json) {
      process.stdout.write(JSON.stringify(pending, null, 2) + "\n");
      return;
    }
    if (pending.length === 0) {
      console.log(chalk.gray("No pending approvals."));
      return;
    }
    console.log();
    console.log(chalk.bold(`${pending.length} pending approval${pending.length > 1 ? "s" : ""}:\n`));
    for (const p of pending) {
      const expiresAt = new Date(p.expiresAt);
      const secondsLeft = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      console.log(`  ${chalk.cyan(p.id)}`);
      console.log(`    agent:   ${p.agentType} (${chalk.gray(p.instanceId)})`);
      console.log(`    tool:    ${chalk.magenta(p.tool)}`);
      console.log(`    reason:  ${p.reason}`);
      console.log(`    expires: ${Math.floor(secondsLeft / 60)}m ${secondsLeft % 60}s`);
      console.log();
    }
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}

// ---- approvals respond ----

const VALID_CHOICES = new Set(["allow_once", "allow_session", "deny"]);

export async function approvalsRespondCommand(
  id: string,
  choice: string,
  options: { durationMs?: string; note?: string }
): Promise<void> {
  if (!VALID_CHOICES.has(choice)) {
    console.error(chalk.red(`Invalid choice: ${choice}`));
    console.error(chalk.gray(`Use one of: allow_once, allow_session, deny`));
    process.exit(1);
  }
  const durationMs = options.durationMs ? parseInt(options.durationMs, 10) : undefined;
  if (options.durationMs && (isNaN(durationMs!) || durationMs! <= 0)) {
    console.error(chalk.red(`Invalid --duration-ms: must be a positive integer`));
    process.exit(1);
  }

  const client = new IpcClient();
  try {
    await client.connect();
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  // Watch for the resolved event confirming our response; bail after 3s.
  const resolved = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3000);
    client.onMessage((msg: ServerMessage) => {
      if (msg.type === "approval_resolved" && msg.id === id) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  client.send({
    type: "respond",
    id,
    choice: choice as "allow_once" | "allow_session" | "deny",
    durationMs,
    note: options.note,
  });
  await resolved;
  client.close();
  console.log(chalk.green(`✓ Sent ${choice} for approval ${id}`));
}

// ---- approvals forward ----

interface ForwardOptions {
  url: string;
  hmacSecret?: string;
  /** Header name that will carry the HMAC-SHA256 hex digest of the body. */
  hmacHeader?: string;
}

export async function approvalsForwardCommand(options: ForwardOptions): Promise<void> {
  try {
    new URL(options.url); // validate
  } catch {
    console.error(chalk.red(`Invalid --url: ${options.url}`));
    process.exit(1);
  }

  const secret = options.hmacSecret ?? process.env.AGENTGUARD_WEBHOOK_HMAC;
  const hmacHeader = options.hmacHeader ?? "x-agentguard-signature";

  const client = new IpcClient();
  try {
    await client.connect();
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  console.log(chalk.green(`Connected to ${socketPath()}`));
  console.log(chalk.gray(`Forwarding approval events → POST ${options.url}`));
  if (secret) console.log(chalk.gray(`HMAC:   signed with ${hmacHeader}`));
  console.log();

  let forwarded = 0;
  client.onMessage(async (msg) => {
    if (msg.type !== "approval_request") return;
    const payload = {
      type: "approval_request",
      id: msg.id,
      pending: msg.pending,
      received_at: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "agentguard-forwarder/0.1",
    };
    if (secret) {
      headers[hmacHeader] = createHmac("sha256", secret).update(body).digest("hex");
    }
    try {
      const r = await fetch(options.url, { method: "POST", body, headers });
      forwarded += 1;
      const line = `[${new Date().toISOString()}] ${msg.pending.tool} → ${r.status}`;
      if (r.ok) console.log(chalk.gray(line));
      else console.error(chalk.yellow(line));
    } catch (err) {
      console.error(chalk.red(`[${new Date().toISOString()}] POST failed: ${(err as Error).message}`));
    }
  });

  client.onClose(() => {
    console.log();
    console.log(chalk.yellow(`Disconnected from socket. Forwarded ${forwarded} event${forwarded === 1 ? "" : "s"}.`));
    process.exit(0);
  });

  process.on("SIGINT", () => {
    console.log();
    console.log(chalk.gray(`Forwarded ${forwarded} event${forwarded === 1 ? "" : "s"}. Exiting.`));
    client.close();
    process.exit(0);
  });
}
