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

  // Wait for the explicit respond_ack before claiming success. Without
  // this, the server silently no-ops when the id doesn't exist and the
  // CLI reports ✓ — which hid real bugs before (security review H1).
  const ack = await new Promise<{ ok: boolean; reason?: string }>((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, reason: "timeout waiting for server ack" }),
      3000
    );
    client.onMessage((msg: ServerMessage) => {
      if (msg.type === "respond_ack" && msg.id === id) {
        clearTimeout(timer);
        resolve({ ok: msg.ok, reason: msg.reason });
      }
    });

    client.send({
      type: "respond",
      id,
      choice: choice as "allow_once" | "allow_session" | "deny",
      durationMs,
      note: options.note,
    });
  });

  client.close();
  if (!ack.ok) {
    console.error(chalk.red(`✗ Server rejected respond: ${ack.reason ?? "no reason"}`));
    process.exit(1);
  }
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
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;

  client.onMessage(async (msg) => {
    if (msg.type !== "approval_request") return;
    const timestamp = Math.floor(Date.now() / 1000).toString();
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
      "x-agentguard-timestamp": timestamp,
    };
    if (secret) {
      // Stripe/GitHub-style signed envelope: sign `timestamp.body` so a
      // passive observer can't replay the exact POST after the receiver's
      // freshness window elapses. Receivers must verify both the HMAC
      // and that |now - timestamp| < their tolerance.
      const signed = `${timestamp}.${body}`;
      headers[hmacHeader] = "t=" + timestamp + ",v1=" + createHmac("sha256", secret).update(signed).digest("hex");
    }
    try {
      const r = await fetch(options.url, { method: "POST", body, headers });
      forwarded += 1;
      const line = `[${new Date().toISOString()}] ${msg.pending.tool} → ${r.status}`;
      if (r.ok) {
        consecutiveFailures = 0;
        console.log(chalk.gray(line));
      } else {
        consecutiveFailures += 1;
        console.error(chalk.yellow(line));
      }
    } catch (err) {
      consecutiveFailures += 1;
      console.error(chalk.red(`[${new Date().toISOString()}] POST failed: ${(err as Error).message}`));
    }

    // Circuit-breaker: after N consecutive failures, exit. systemd (or
    // whatever supervisor) should restart us on a backoff schedule.
    // Without this, a broken webhook URL eats every approval event
    // silently forever. Security review L1.
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error(
        chalk.red(
          `\n✗ ${MAX_CONSECUTIVE_FAILURES} consecutive webhook failures — giving up. Check the URL and restart.`
        )
      );
      client.close();
      process.exit(2);
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
