/**
 * Structured policy decisions (OPA pattern).
 * Every policy evaluation returns a rich object, not just allow/deny.
 */

export type ActionType = "allow" | "deny" | "require_approval";

export type EnforcementLevel = "advisory" | "soft_mandatory" | "hard_mandatory";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ApprovalOption =
  | "allow_once"
  | "allow_1hr"
  | "allow_this_domain"
  | "allow_this_tool"
  | "deny";

export interface PolicyDecision {
  action: ActionType;
  reason: string;
  tool: string;
  args?: Record<string, unknown>;
  enforcement: EnforcementLevel;
  risk_level: RiskLevel;
  rule_matched?: string;
  tier: "built_in" | "user" | "session";
  approval_options?: ApprovalOption[];
  context?: {
    agent?: string;
    session_cost_so_far?: number;
    registry?: string;
    glama_grade?: string;
  };
}
