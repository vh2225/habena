import { DownstreamManager } from "../../downstream/manager.js";
import { loadYaml } from "../../config/loader.js";
import { getConfigPath } from "../../config/paths.js";
import type { AgentGuardConfig } from "../../policy/types.js";
import type { Check, CheckResult } from "../types.js";

/**
 * Spawns each configured downstream MCP server using DownstreamManager
 * and reports the per-server status. This reuses the auth-probe support
 * already in DownstreamClient, so the output reflects authentication
 * state too, not just process liveness.
 */
export const downstreamReachableCheck: Check = {
  name: "downstream-reachable",
  async run(): Promise<CheckResult> {
    const config = loadYaml<AgentGuardConfig>(getConfigPath()) ?? {};
    const servers = config.mcp_servers ?? {};
    const count = Object.keys(servers).length;

    if (count === 0) {
      return {
        name: "downstream-reachable",
        status: "warn",
        detail: "No mcp_servers configured in config.yaml",
        fixHint: "Add downstream MCP servers or run `agentguard install openclaw`.",
      };
    }

    const mgr = new DownstreamManager(servers);
    try {
      await mgr.start();
      const statuses = mgr.status();
      const alive = statuses.filter((s) => s.alive).length;
      const authenticated = statuses.filter((s) => s.authStatus === "authenticated").length;
      const authFailed = statuses.filter((s) => s.authStatus === "auth_failed").length;
      const dead = statuses.filter((s) => !s.alive);

      if (dead.length > 0) {
        const names = dead.map((s) => `${s.name}: ${s.error ?? "?"}`).join("; ");
        return {
          name: "downstream-reachable",
          status: "fail",
          detail: `${count - dead.length}/${count} alive (${names})`,
          fixHint: "Check the failing server's package installation and command path.",
        };
      }

      if (authFailed > 0) {
        const names = statuses
          .filter((s) => s.authStatus === "auth_failed")
          .map((s) => `${s.name}: ${s.authError ?? "auth failed"}`)
          .join("; ");
        return {
          name: "downstream-reachable",
          status: "fail",
          detail: `${alive}/${count} alive, but auth failed on: ${names}`,
          fixHint: "Re-run the downstream's auth flow or re-issue its token.",
        };
      }

      const detail =
        authenticated > 0
          ? `${alive}/${count} alive, ${authenticated} authenticated`
          : `${alive}/${count} alive (auth unchecked — consider adding \`auth_probe\` to each mcp_server)`;
      return { name: "downstream-reachable", status: "pass", detail };
    } catch (err) {
      return {
        name: "downstream-reachable",
        status: "fail",
        detail: `Downstream manager failed: ${(err as Error).message}`,
      };
    } finally {
      await mgr.stop().catch(() => {});
    }
  },
};
