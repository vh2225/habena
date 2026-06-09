import type { DownstreamServerConfig } from "../downstream/types.js";
import type { ThreatConfig } from "../threat/types.js";

export interface MatchCondition {
  tool?: string;              // exact match or wildcard (e.g., "shell_*")
  tool_tag?: string;          // semantic tag like "communication", "filesystem"
  args_contain?: string[];    // substring matches against stringified args
  command_matches?: string[]; // for shell_execute: command substring matches
  path_starts_with?: string[];
  registry?: string;          // which MCP registry the server came from
  glama_grade?: string[];     // Phase 2 — placeholder for type compatibility
  url_not_in?: string;        // path to file with allowlist of URLs
  body_contains_file_content?: boolean;
}

export interface Rule {
  match: MatchCondition;
  action: "allow" | "deny" | "require_approval" | "deny_unless" | "deny_if";
  enforcement?: "advisory" | "soft_mandatory" | "hard_mandatory";
  condition?: Record<string, unknown>;
  reason?: string;
  timeout?: string;  // e.g., "5m"
}

export interface BudgetConfig {
  daily?: number;
  monthly?: number;
  per_session?: number;
  per_request?: number;
  alert_at?: number[];
  on_exceed?: "deny" | "warn" | "require_approval";
}

export interface ApprovalConfig {
  timeout?: string;              // duration string like "5m"
  timeout_action?: "deny" | "allow";
  batch_similar?: boolean;
  /**
   * Tools and tool tags that always require approval, overriding user allow rules.
   * Checked before user rules in the policy engine.
   */
  require_for?: {
    tools?: string[];
    tool_tags?: string[];
  };
  /**
   * Out-of-band approval delivery channels. Each entry is constructed and
   * lifecycle-managed by the proxy (see ApprovalChannel). No implementation is
   * wired yet beyond Telegram's config shape; tasks downstream plug the actual
   * channel in.
   */
  channels?: {
    telegram?: {
      token?: string;
      token_env?: string;
      owner_id: string | number;
    };
  };
}

export interface AgentGuardConfig {
  budget?: BudgetConfig;
  /**
   * Named rule packs to import and prepend to `rules`. Pack rules come
   * FIRST in the effective rule list; the user's `rules` come after, so
   * user overrides still win under first-match-wins semantics.
   * Resolved from `packages/core/rule-packs/` (shipped) or
   * `~/.habena/rule-packs/` (user-authored); user packs with the
   * same name override shipped ones.
   */
  extends?: string[];
  rules?: Rule[];
  approval?: ApprovalConfig;
  mcp_servers?: Record<string, DownstreamServerConfig>;
  /** Per-detector enforcement; resolveThreatConfig() applies defaults. */
  threat?: Partial<ThreatConfig>;
}
