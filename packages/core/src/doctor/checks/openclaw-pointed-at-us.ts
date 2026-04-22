import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Check, CheckResult } from "../types.js";

/**
 * If OpenClaw is installed (i.e. ~/.openclaw/openclaw.json exists),
 * verify that its MCP config has an entry named "agentguard" and that
 * the entry's command/args plausibly point at our binary.
 *
 * If OpenClaw isn't installed at all, this check is a no-op pass —
 * AgentGuard is usable without OpenClaw.
 */
export const openclawPointedAtUsCheck: Check = {
  name: "openclaw-pointed-at-us",
  async run(): Promise<CheckResult> {
    const openclawConfig = join(homedir(), ".openclaw", "openclaw.json");
    if (!existsSync(openclawConfig)) {
      return {
        name: "openclaw-pointed-at-us",
        status: "pass",
        detail: "OpenClaw not installed (nothing to check)",
      };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(readFileSync(openclawConfig, "utf8"));
    } catch (err) {
      return {
        name: "openclaw-pointed-at-us",
        status: "fail",
        detail: `Unparseable openclaw.json: ${(err as Error).message}`,
      };
    }

    const mcp = (parsed.mcp ?? {}) as Record<string, unknown>;
    const servers = (mcp.servers ?? {}) as Record<string, { command?: string; args?: string[] }>;
    const entry = servers["agentguard"];
    if (!entry) {
      return {
        name: "openclaw-pointed-at-us",
        status: "fail",
        detail: "No `agentguard` entry in OpenClaw's mcp.servers",
        fixHint: "Run `agentguard install openclaw --force`.",
      };
    }

    // Soft check: does the command/args mention agentguard?
    const argList = [entry.command ?? "", ...(entry.args ?? [])];
    const argStr = argList.join(" ").toLowerCase();
    if (!argStr.includes("agentguard")) {
      return {
        name: "openclaw-pointed-at-us",
        status: "warn",
        detail: `openclaw.json has an \`agentguard\` server but its command doesn't mention us: ${argStr}`,
        fixHint: "Run `agentguard install openclaw --force` to re-link.",
      };
    }

    // Verify the paths OpenClaw will try to exec actually exist on disk.
    // Catches the case where we upgraded/moved the install and OpenClaw's
    // config now points at a deleted path.
    for (const a of argList) {
      if (a.startsWith("/") && a.endsWith(".js")) {
        if (!existsSync(a)) {
          return {
            name: "openclaw-pointed-at-us",
            status: "fail",
            detail: `openclaw.json references ${a} but that file no longer exists`,
            fixHint: "Run `agentguard install openclaw --force` to re-link with the current install path.",
          };
        }
      }
    }

    return {
      name: "openclaw-pointed-at-us",
      status: "pass",
      detail: `openclaw.json → ${entry.command} ${(entry.args ?? []).join(" ")}`,
    };
  },
};
