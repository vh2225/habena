import { existsSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { getConfigDir } from "../../config/paths.js";
import type { Check, CheckResult } from "../types.js";

/**
 * Combined "is the proxy running and reachable?" check. Spec lists
 * proxy-running + ipc-socket as separate items, but they both answer
 * the same operator question, and we don't write a pid file yet, so
 * collapsing is the pragmatic call.
 *
 * pass: socket exists, is a UNIX socket, and sends a `hello` frame
 *       within 500ms of connect.
 * fail: socket missing / not a socket / no hello received.
 */
export const proxyReachableCheck: Check = {
  name: "proxy-reachable",
  async run(): Promise<CheckResult> {
    const socketPath = join(getConfigDir(), "agentguard.sock");

    if (!existsSync(socketPath)) {
      return {
        name: "proxy-reachable",
        status: "fail",
        detail: `No socket at ${socketPath}`,
        fixHint: "Run `agentguard start` (or check the systemd user service is active).",
      };
    }

    try {
      const s = statSync(socketPath);
      if (!s.isSocket()) {
        return {
          name: "proxy-reachable",
          status: "fail",
          detail: `${socketPath} exists but is not a UNIX socket`,
          fixHint: "Delete the stale file and restart the proxy.",
        };
      }
    } catch (err) {
      return {
        name: "proxy-reachable",
        status: "fail",
        detail: `stat failed: ${(err as Error).message}`,
        fixHint: "Check permissions on ~/.agentguard/",
      };
    }

    // Try to connect and wait for the `hello` frame.
    return await new Promise<CheckResult>((resolve) => {
      const start = Date.now();
      const sock = createConnection(socketPath);
      let done = false;
      const finish = (result: CheckResult) => {
        if (done) return;
        done = true;
        sock.destroy();
        resolve(result);
      };
      const timer = setTimeout(() => {
        finish({
          name: "proxy-reachable",
          status: "fail",
          detail: "Connected but no hello frame within 500ms",
          fixHint: "Proxy may be hung — restart it.",
        });
      }, 500);
      sock.on("data", (chunk) => {
        clearTimeout(timer);
        const line = chunk.toString().split("\n")[0];
        try {
          const msg = JSON.parse(line);
          if (msg?.type === "hello") {
            finish({
              name: "proxy-reachable",
              status: "pass",
              detail: `hello in ${Date.now() - start}ms (v${msg.version ?? "?"})`,
            });
            return;
          }
        } catch {
          // fall through
        }
        finish({
          name: "proxy-reachable",
          status: "fail",
          detail: "Connected but first message wasn't a `hello`",
          fixHint: "Protocol mismatch — check proxy version.",
        });
      });
      sock.on("error", (err) => {
        clearTimeout(timer);
        finish({
          name: "proxy-reachable",
          status: "fail",
          detail: `Connect failed: ${err.message}`,
          fixHint: "Is `agentguard start` running? Check the systemd user service.",
        });
      });
    });
  },
};
