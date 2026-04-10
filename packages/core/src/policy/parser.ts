/**
 * YAML config parser for agentguard.yaml.
 */

export interface MatchCondition {
  tool?: string;
  tool_tag?: string;
  args_contain?: string[];
  registry?: string;
  glama_grade?: string[];
  path_starts_with?: string[];
  body_contains_file_content?: boolean;
  url_not_in?: string;
  command_matches?: string[];
}

export interface Rule {
  match: MatchCondition;
  action: "allow" | "deny" | "require_approval" | "deny_unless" | "deny_if";
  enforcement?: "advisory" | "soft_mandatory" | "hard_mandatory";
  condition?: Record<string, unknown>;
  reason?: string;
  timeout?: string;
}

export interface BudgetConfig {
  daily?: number;
  monthly?: number;
  per_session?: number;
  per_request?: number;
  alert_at?: number[];
  on_exceed?: "deny" | "warn" | "require_approval";
}

export interface RegistryConfig {
  url: string;
  trust_level: "verified" | "known" | "unknown";
  use_connect?: boolean;
  enrich?: boolean;
}

export interface ApprovalConfig {
  timeout?: string;
  timeout_action?: "deny" | "allow";
  batch_similar?: boolean;
}

export interface AgentGuardConfig {
  budget: BudgetConfig;
  rules: Rule[];
  registries?: Record<string, RegistryConfig>;
  approval?: ApprovalConfig;
}

export function parseConfig(configPath: string): AgentGuardConfig {
  // TODO: Read YAML file and parse into typed config
  throw new Error("Not implemented");
}
