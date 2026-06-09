import { homedir } from "node:os";
import type { Rule, MatchCondition } from "./types.js";

export interface ToolCallContext {
  tool: string;
  args: Record<string, unknown>;
  tool_tag?: string;
  registry?: string;
  mcp_server?: string;
}

/**
 * Decides whether a Rule's `match` block applies to a tool call.
 *
 * Semantics:
 * - Every declared field in `match` must pass (AND across fields).
 * - `args_contain`: ALL needles must be substrings of JSON.stringify(args) (AND within the field).
 *   NOTE: Substring matching on serialized JSON can cause false positives for very short needles
 *   that overlap with key names. Rule authors should use specific needles like "rm -rf", not "rm".
 * - `command_matches`: ANY needle must be a substring of args.command (OR within the field).
 * - `path_starts_with`: ANY prefix must match args.path (OR within the field). `~` prefixes
 *   are expanded against the home directory, since args.path arrives absolute.
 * - Fields not used in Phase 1 (body_contains_file_content, url_not_in, glama_grade) are ignored;
 *   they are reserved for Phase 2.
 */
export function matches(rule: Rule, call: ToolCallContext): boolean {
  return fieldsMatch(rule.match, call);
}

/**
 * Field-level predicate shared by `match` blocks and conditional-rule
 * `condition` blocks (deny_unless / deny_if) — both use the same vocabulary.
 */
export function fieldsMatch(m: MatchCondition, call: ToolCallContext): boolean {
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

  if (m.path_starts_with) {
    const path = String(call.args.path ?? "");
    if (!m.path_starts_with.some((prefix) => path.startsWith(expandTilde(prefix)))) return false;
  }

  return true;
}

function expandTilde(prefix: string): string {
  if (prefix === "~" || prefix.startsWith("~/")) return homedir() + prefix.slice(1);
  return prefix;
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
