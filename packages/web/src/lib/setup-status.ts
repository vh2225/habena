import { parse } from "yaml";

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
