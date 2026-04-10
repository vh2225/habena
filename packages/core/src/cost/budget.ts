import type { CostTracker } from "./tracker.js";
import type { BudgetConfig } from "../policy/types.js";
import type { PolicyDecision } from "../policy/decisions.js";

export interface BudgetCheckContext {
  agentType: string;
  instanceId: string;
  proposedCost: number;
}

export class BudgetEnforcer {
  constructor(
    private tracker: CostTracker,
    private budget: BudgetConfig
  ) {}

  check(ctx: BudgetCheckContext): PolicyDecision | null {
    const { agentType, instanceId, proposedCost } = ctx;

    if (this.budget.per_request !== undefined && proposedCost > this.budget.per_request) {
      return this.denial(`Exceeds per-request limit of $${this.budget.per_request}`);
    }

    if (this.budget.per_session !== undefined) {
      const sessionSpend = this.tracker.getInstanceSpend(instanceId);
      if (sessionSpend + proposedCost > this.budget.per_session) {
        return this.denial(
          `Exceeds session limit: $${sessionSpend.toFixed(2)} + $${proposedCost.toFixed(2)} > $${this.budget.per_session}`
        );
      }
    }

    if (this.budget.daily !== undefined) {
      const dailySpend = this.tracker.getDailySpend(agentType);
      if (dailySpend + proposedCost > this.budget.daily) {
        return this.denial(
          `Exceeds daily limit: $${dailySpend.toFixed(2)} + $${proposedCost.toFixed(2)} > $${this.budget.daily}`
        );
      }
    }

    if (this.budget.monthly !== undefined) {
      const monthlySpend = this.tracker.getMonthlySpend(agentType);
      if (monthlySpend + proposedCost > this.budget.monthly) {
        return this.denial(
          `Exceeds monthly limit: $${monthlySpend.toFixed(2)} + $${proposedCost.toFixed(2)} > $${this.budget.monthly}`
        );
      }
    }

    return null;
  }

  private denial(reason: string): PolicyDecision {
    return {
      action: "deny",
      reason,
      tool: "*",
      enforcement: "hard_mandatory",
      risk_level: "critical",
      tier: "built_in",
    };
  }
}
