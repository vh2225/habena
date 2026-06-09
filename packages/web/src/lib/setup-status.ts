import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { configDir } from "./config-dir";
import { proxyRunning } from "./approval-ipc";
import { summary } from "./audit";

export interface SetupStatus {
  configExists: boolean;
  downstreams: string[];
  agents: string[];
  telegramConfigured: boolean;
  proxyRunning: boolean;
  decisionCount: number;
}

export interface SetupStatusInput {
  configExists: boolean;
  configText: string | null;
  agentsText: string | null;
  proxyRunning: boolean;
  decisionCount: number;
}

function safeParse(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v = parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function keysOf(obj: unknown): string[] {
  return obj && typeof obj === "object" ? Object.keys(obj as Record<string, unknown>) : [];
}

/** Pure: derive the wizard's view of setup state from already-read inputs. Never throws. */
export function parseSetupStatus(input: SetupStatusInput): SetupStatus {
  const config = safeParse(input.configText);
  const agents = safeParse(input.agentsText);
  const channels = ((config?.approval as Record<string, unknown> | undefined)?.channels) as
    | Record<string, unknown>
    | undefined;
  return {
    configExists: input.configExists,
    downstreams: keysOf(config?.mcp_servers),
    agents: keysOf(agents?.agents),
    telegramConfigured: Boolean(channels?.telegram),
    proxyRunning: input.proxyRunning,
    decisionCount: input.decisionCount,
  };
}

/** IO wrapper: read the config dir + socket + audit count, then parse. */
export function readSetupStatus(): SetupStatus {
  const configPath = join(configDir(), "config.yaml");
  const agentsPath = join(configDir(), "agents.yaml");
  const configExists = existsSync(configPath);
  const read = (p: string): string | null => {
    try {
      return existsSync(p) ? readFileSync(p, "utf8") : null;
    } catch {
      return null;
    }
  };
  let decisionCount = 0;
  try {
    decisionCount = summary().totalDecisions;
  } catch {
    decisionCount = 0;
  }
  return parseSetupStatus({
    configExists,
    configText: read(configPath),
    agentsText: read(agentsPath),
    proxyRunning: proxyRunning(),
    decisionCount,
  });
}

/** Shell-quote a path only if it contains whitespace (good enough for display copy). */
function quoteArg(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s;
}

export function downstreamAddCommand(path: string): string {
  return `habena downstream add filesystem ${quoteArg(path.trim() || "~/workspace")}`;
}

export function agentAddCommand(name: string, budgetDaily: number): string {
  return `habena agent add --name ${name} --budget-daily ${budgetDaily}`;
}
