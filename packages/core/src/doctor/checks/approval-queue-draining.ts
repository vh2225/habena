import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { getConfigDir } from "../../config/paths.js";
import type { Check, CheckResult } from "../types.js";

/**
 * Detect approvals that have been sitting in the queue longer than the
 * default timeout. A stale queue usually means `agentguard watch` crashed,
 * the Tauri UI disconnected without resolving anything, or the user walked
 * away mid-approval. Auto-deny kicks in eventually, but surfacing this at
 * doctor time helps the user notice BEFORE the agent gets a surprising deny.
 *
 * Implementation: connect to the IPC socket. IpcServer.handleConnection
 * replays currently-pending approvals on connect — we collect those for
 * ~1s then close. No new IPC protocol needed.
 */
export const approvalQueueDrainingCheck: Check = {
  name: "approval-queue-draining",
  async run(): Promise<CheckResult> {
    const socketPath = join(getConfigDir(), "agentguard.sock");
    if (!existsSync(socketPath)) {
      // Proxy isn't running — proxy-reachable check owns that signal.
      // Don't double-report here.
      return {
        name: "approval-queue-draining",
        status: "pass",
        detail: "Proxy not running (queue is empty by definition)",
      };
    }

    const WARN_AGE_MS = 10 * 60 * 1000;   // 10 min
    const FAIL_AGE_MS = 30 * 60 * 1000;   // 30 min
    const SNAPSHOT_MS = 750;              // how long to collect replayed events

    type Pending = { id: string; createdAt: number };
    const pending: Pending[] = [];

    return await new Promise<CheckResult>((resolve) => {
      const sock = createConnection(socketPath);
      let buf = "";
      let done = false;
      const finish = (result: CheckResult) => {
        if (done) return;
        done = true;
        sock.destroy();
        resolve(result);
      };
      const snapshotTimer = setTimeout(() => {
        // Done collecting — evaluate
        if (pending.length === 0) {
          finish({
            name: "approval-queue-draining",
            status: "pass",
            detail: "No pending approvals",
          });
          return;
        }
        const now = Date.now();
        const ages = pending
          .map((p) => ({ id: p.id, ageMs: now - p.createdAt }))
          .sort((a, b) => b.ageMs - a.ageMs);
        const oldest = ages[0];
        const oldestMin = Math.round(oldest.ageMs / 60000);
        if (oldest.ageMs >= FAIL_AGE_MS) {
          finish({
            name: "approval-queue-draining",
            status: "fail",
            detail: `${pending.length} pending, oldest ${oldestMin}m old`,
            fixHint: "`agentguard watch` likely crashed. Restart it, or enable forwarding (Phase 7).",
          });
        } else if (oldest.ageMs >= WARN_AGE_MS) {
          finish({
            name: "approval-queue-draining",
            status: "warn",
            detail: `${pending.length} pending, oldest ${oldestMin}m old`,
            fixHint: "No approver attached? Check `agentguard watch` is running.",
          });
        } else {
          finish({
            name: "approval-queue-draining",
            status: "pass",
            detail: `${pending.length} pending, all under 10m old`,
          });
        }
      }, SNAPSHOT_MS);
      const connectTimer = setTimeout(() => {
        clearTimeout(snapshotTimer);
        finish({
          name: "approval-queue-draining",
          status: "warn",
          detail: "IPC connected but no replay frames received",
        });
      }, SNAPSHOT_MS + 1000);
      sock.on("data", (chunk) => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg?.type === "approval_request" && msg?.pending?.createdAt) {
              pending.push({
                id: msg.pending.id ?? msg.id ?? "?",
                createdAt: new Date(msg.pending.createdAt).getTime(),
              });
            }
          } catch {
            // ignore malformed line
          }
        }
      });
      sock.on("error", () => {
        clearTimeout(snapshotTimer);
        clearTimeout(connectTimer);
        finish({
          name: "approval-queue-draining",
          status: "warn",
          detail: "IPC connection errored; queue state unknown",
        });
      });
      // Close connection after snapshot period whether or not any replay arrived.
      sock.on("close", () => {
        clearTimeout(connectTimer);
      });
    });
  },
};
