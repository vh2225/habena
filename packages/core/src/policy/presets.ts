import type { Rule, AgentGuardConfig } from "./types.js";

/**
 * Named preset = a canned `rules:` block + a note explaining what it's for.
 * Applying a preset writes to the user's ~/.habena/config.yaml; it does
 * NOT touch the host-policy floor (that's a separate feature).
 */
export interface Preset {
  name: string;
  description: string;
  rules: Rule[];
}

const HARD_BOUNDARIES: Rule[] = [
  {
    match: { tool: "shell_*", args_contain: ["rm -rf", "DROP TABLE", "DROP DATABASE"] },
    action: "deny",
    enforcement: "hard_mandatory",
    reason: "Destructive shell command blocked",
  },
];

export const PRESETS: Record<string, Preset> = {
  observe: {
    name: "observe",
    description:
      "Log everything, block nothing. Use as a baseline for the first week of operation while you learn what your agent actually does.",
    rules: [
      ...HARD_BOUNDARIES,
      {
        match: { tool: "*" },
        action: "allow",
        reason: "Observe mode — everything is logged but nothing is blocked",
      },
    ],
  },
  cautious: {
    name: "cautious",
    description:
      "Sensible defaults for a trusted solo user: allow read/list, require approval for writes and destructive ops, hard-deny everything else. Start here after a week of observe.",
    rules: [
      ...HARD_BOUNDARIES,
      // Read-only operations: allow
      {
        match: { tool: "read_*" },
        action: "allow",
        reason: "Reads are safe",
      },
      {
        match: { tool: "list_*" },
        action: "allow",
        reason: "Directory listings are safe",
      },
      {
        match: { tool: "search_*" },
        action: "allow",
        reason: "Searches are safe",
      },
      {
        match: { tool: "get_*" },
        action: "allow",
        reason: "Gets are safe",
      },
      // Outbound communication: require approval (catches gmail_send, slack_send, etc.)
      {
        match: { tool_tag: "communication" },
        action: "require_approval",
        enforcement: "soft_mandatory",
        reason: "Outbound communication requires approval",
      },
      // Writes: require approval
      {
        match: { tool: "write_*" },
        action: "require_approval",
        enforcement: "soft_mandatory",
        reason: "Writes require approval",
      },
      {
        match: { tool: "create_*" },
        action: "require_approval",
        enforcement: "soft_mandatory",
        reason: "Creation requires approval",
      },
      {
        match: { tool: "update_*" },
        action: "require_approval",
        enforcement: "soft_mandatory",
        reason: "Updates require approval",
      },
      // Destructive operations: hard-deny
      {
        match: { tool: "delete_*" },
        action: "deny",
        enforcement: "hard_mandatory",
        reason: "Destructive operations blocked (use explicit rule to allow)",
      },
      {
        match: { tool: "drop_*" },
        action: "deny",
        enforcement: "hard_mandatory",
        reason: "Destructive operations blocked",
      },
      // Fallthrough: require approval rather than silently allow or deny
      {
        match: { tool: "*" },
        action: "require_approval",
        enforcement: "soft_mandatory",
        reason: "Unknown tool — ask before running",
      },
    ],
  },
  "deny-all": {
    name: "deny-all",
    description:
      "Air-gapped. Every tool call is hard-denied. Use as a lockdown posture; you'll need to add explicit allow rules above this baseline for anything the agent can do.",
    rules: [
      ...HARD_BOUNDARIES,
      {
        match: { tool: "*" },
        action: "deny",
        enforcement: "hard_mandatory",
        reason: "deny-all preset active — add explicit rules above this to unblock tools",
      },
    ],
  },
};

export function listPresets(): Preset[] {
  return Object.values(PRESETS);
}

export function getPreset(name: string): Preset | undefined {
  return PRESETS[name];
}

/**
 * Merge a preset's rules into an existing config. Replaces the `rules`
 * block entirely — presets are a posture choice, not additive tweaks.
 * `mcp_servers`, `budget`, `approval` are preserved.
 */
export function applyPreset(config: AgentGuardConfig, preset: Preset): AgentGuardConfig {
  return {
    ...config,
    rules: preset.rules,
  };
}
