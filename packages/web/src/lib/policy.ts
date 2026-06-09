// CLIENT-SAFE: no node/server imports. Shared types + pure helper.

export interface RuleView {
  index: number;
  match: Record<string, unknown>;
  action: string;
  enforcement: string | null;
  reason: string | null;
}
export interface BudgetView {
  daily: number | null;
  monthly: number | null;
  perSession: number | null;
  perRequest: number | null;
  onExceed: string | null;
  alertAt: number[] | null;
}
export interface ApprovalView {
  timeoutAction: string | null;
  alwaysRequire: string[];
  channels: string[]; // channel NAMES only — never tokens
}
export interface DownstreamView {
  name: string;
  command: string | null;
}
export interface PolicyView {
  configured: boolean;
  budget: BudgetView | null;
  rules: RuleView[];
  extendsPacks: string[];
  approval: ApprovalView | null;
  downstreams: DownstreamView[];
}

export function actionKind(action: string): "allow" | "deny" | "warn" | "neutral" {
  if (action === "allow") return "allow";
  if (action === "deny" || action === "deny_if" || action === "deny_unless") return "deny";
  if (action === "require_approval") return "warn";
  return "neutral";
}
