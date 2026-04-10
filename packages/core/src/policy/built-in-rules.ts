/**
 * Built-in rules shipped with AgentGuard.
 * Hard boundaries cannot be overridden by user rules.
 * Defaults can be overridden.
 */

import type { Rule } from "./types.js";

export const HARD_BOUNDARIES: Rule[] = [
  {
    match: { command_matches: ["rm -rf /", "rm -rf ~", "rm -rf /*", ":(){ :|:& };:"] },
    action: "deny",
    enforcement: "hard_mandatory",
    reason: "Destructive system command — hard blocked",
  },
  {
    match: { command_matches: ["DROP DATABASE", "DROP TABLE", "TRUNCATE TABLE"] },
    action: "deny",
    enforcement: "hard_mandatory",
    reason: "Destructive database command — hard blocked",
  },
  {
    match: { command_matches: ["chmod -R 777 /", "mkfs", "dd if="] },
    action: "deny",
    enforcement: "hard_mandatory",
    reason: "Dangerous system modification — hard blocked",
  },
];

export const DEFAULTS: Rule[] = [
  {
    match: { tool_tag: "communication" },
    action: "require_approval",
    enforcement: "soft_mandatory",
    reason: "Outbound communication requires approval",
    timeout: "5m",
  },
  {
    match: { tool: "filesystem_write" },
    action: "deny_unless",
    enforcement: "soft_mandatory",
    condition: { path_starts_with: ["~/workspace", "/tmp"] },
    reason: "File writes restricted to workspace and tmp",
  },
  {
    match: { registry: "unknown" },
    action: "require_approval",
    enforcement: "soft_mandatory",
    reason: "Unregistered MCP server — approval required on first use",
  },
];
