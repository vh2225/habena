import type { CostTracker } from "./tracker.js";
import type { BudgetConfig } from "../policy/types.js";
import type { PolicyDecision } from "../policy/decisions.js";

export interface BudgetCheckContext {
  agentType: string;
  instanceId: string;
  proposedCost: number;
}

/**
 * Two classes of limits with different teeth:
 *
 *  - DOLLAR limits (per_request/per_session/daily/monthly) run against
 *    declared per-tool pricing — a config guess. Overruns follow
 *    `on_exceed`: "warn" (default — alert once per limit, never block),
 *    "require_approval", or "deny".
 *  - CALL-COUNT and RESULT-TOKEN limits are loop guards built on measured
 *    data. They always hard-deny.
 */
export class BudgetEnforcer {
  /** Limits already alerted on (warn mode fires once per limit per run). */
  private alerted = new Set<string>();

  constructor(
    private tracker: CostTracker,
    private budget: BudgetConfig,
    private onAlert?: (message: string) => void
  ) {}

  check(ctx: BudgetCheckContext): PolicyDecision | null {
    const { agentType, instanceId, proposedCost } = ctx;

    if (this.budget.per_request !== undefined && proposedCost > this.budget.per_request) {
      const d = this.dollarOverrun("per_request", `Exceeds per-request limit of $${this.budget.per_request}`);
      if (d) return d;
    }

    if (this.budget.per_session !== undefined) {
      const sessionSpend = this.tracker.getInstanceSpend(instanceId);
      if (sessionSpend + proposedCost > this.budget.per_session) {
        const d = this.dollarOverrun(
          "per_session",
          `Exceeds session limit: $${sessionSpend.toFixed(2)} + $${proposedCost.toFixed(2)} > $${this.budget.per_session}`
        );
        if (d) return d;
      }
    }

    if (this.budget.daily !== undefined) {
      const dailySpend = this.tracker.getDailySpend(agentType);
      if (dailySpend + proposedCost > this.budget.daily) {
        const d = this.dollarOverrun(
          "daily",
          `Exceeds daily limit: $${dailySpend.toFixed(2)} + $${proposedCost.toFixed(2)} > $${this.budget.daily}`
        );
        if (d) return d;
      }
    }

    if (this.budget.monthly !== undefined) {
      const monthlySpend = this.tracker.getMonthlySpend(agentType);
      if (monthlySpend + proposedCost > this.budget.monthly) {
        const d = this.dollarOverrun(
          "monthly",
          `Exceeds monthly limit: $${monthlySpend.toFixed(2)} + $${proposedCost.toFixed(2)} > $${this.budget.monthly}`
        );
        if (d) return d;
      }
    }

    // Call-count limits: the runaway-loop guard. These enforce regardless of
    // cost attribution — every allowed call counts as one.
    const calls = this.budget.calls;
    if (calls) {
      if (calls.per_minute !== undefined) {
        const n = this.tracker.countCallsSince(agentType, new Date(Date.now() - 60_000));
        if (n >= calls.per_minute) {
          return this.denial(`Exceeds rate limit: ${n} calls in the last minute (limit ${calls.per_minute}/min)`);
        }
      }
      if (calls.per_hour !== undefined) {
        const n = this.tracker.countCallsSince(agentType, new Date(Date.now() - 3_600_000));
        if (n >= calls.per_hour) {
          return this.denial(`Exceeds rate limit: ${n} calls in the last hour (limit ${calls.per_hour}/hr)`);
        }
      }
      if (calls.per_day !== undefined) {
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const n = this.tracker.countCallsSince(agentType, midnight);
        if (n >= calls.per_day) {
          return this.denial(`Exceeds call budget: ${n} calls today (limit ${calls.per_day}/day)`);
        }
      }
    }

    // Result-token limits: caps on the estimated tokens tool results inject
    // into the agent's context — measured data, so always hard-deny.
    const tokens = this.budget.result_tokens;
    if (tokens) {
      if (tokens.per_hour !== undefined) {
        const n = this.tracker.resultTokensSince(agentType, new Date(Date.now() - 3_600_000));
        if (n >= tokens.per_hour) {
          return this.denial(`Exceeds result-size budget: ~${n} tokens of tool results in the last hour (limit ${tokens.per_hour}/hr)`);
        }
      }
      if (tokens.per_day !== undefined) {
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const n = this.tracker.resultTokensSince(agentType, midnight);
        if (n >= tokens.per_day) {
          return this.denial(`Exceeds result-size budget: ~${n} tokens of tool results today (limit ${tokens.per_day}/day)`);
        }
      }
    }

    return null;
  }

  /** Dollar overrun → decision per on_exceed; warn alerts once per limit and lets the call through. */
  private dollarOverrun(limit: string, reason: string): PolicyDecision | null {
    const mode = this.budget.on_exceed ?? "warn";
    if (mode === "deny") return this.denial(reason);
    if (mode === "require_approval") {
      return {
        action: "require_approval",
        reason,
        tool: "*",
        enforcement: "soft_mandatory",
        risk_level: "high",
        tier: "built_in",
      };
    }
    if (!this.alerted.has(limit)) {
      this.alerted.add(limit);
      this.onAlert?.(`Budget warning: ${reason} (on_exceed: warn — calls continue; set on_exceed: deny to block)`);
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
