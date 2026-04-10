export type ActionType = "allow" | "deny" | "require_approval";
export type EnforcementLevel = "advisory" | "soft_mandatory" | "hard_mandatory";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type RuleTier = "built_in" | "user" | "session";

export interface PolicyDecision {
  action: ActionType;
  reason: string;
  tool: string;
  enforcement: EnforcementLevel;
  risk_level: RiskLevel;
  tier: RuleTier;
  rule_matched?: string;
  context?: {
    agent_type?: string;
    instance_id?: string;
    session_cost?: number;
  };
}
