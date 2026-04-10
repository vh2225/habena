import type { Rule, MatchCondition } from "./types.js";

export interface ToolCallContext {
  tool: string;
  args: Record<string, unknown>;
  tool_tag?: string;
  registry?: string;
  mcp_server?: string;
}

export function matches(rule: Rule, call: ToolCallContext): boolean {
  const m = rule.match;

  if (m.tool !== undefined && !matchToolName(m.tool, call.tool)) return false;
  if (m.tool_tag !== undefined && m.tool_tag !== call.tool_tag) return false;
  if (m.registry !== undefined && m.registry !== call.registry) return false;

  if (m.args_contain) {
    const argsStr = JSON.stringify(call.args);
    if (!m.args_contain.every((needle) => argsStr.includes(needle))) return false;
  }

  if (m.command_matches) {
    const command = String(call.args.command ?? "");
    if (!m.command_matches.some((needle) => command.includes(needle))) return false;
  }

  return true;
}

function matchToolName(pattern: string, tool: string): boolean {
  if (pattern === "*") return true;
  if (pattern === tool) return true;
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return tool.startsWith(prefix);
  }
  return false;
}
