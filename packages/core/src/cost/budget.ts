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
/** Per-agent overrides from agents.yaml (`habena agent add --budget-daily N`). */
export interface AgentBudgetOverride {
  daily?: number;
  per_session?: number;
}

export class BudgetEnforcer {
  /** Limits already alerted on (warn mode fires once per limit per run). */
  private alerted = new Set<string>();

  constructor(
    private tracker: CostTracker,
    private globalBudget: BudgetConfig,
    private onAlert?: (message: string) => void,
    private agentOverrides?: Map<string, AgentBudgetOverride>
  ) {}

  /** Effective budget for an agent: per-agent fields win over the global config. */
  private budgetFor(agentType: string): BudgetConfig {
    const over = this.agentOverrides?.get(agentType);
    if (!over) return this.globalBudget;
    return {
      ...this.globalBudget,
      ...(over.daily !== undefined ? { daily: over.daily } : {}),
      ...(over.per_session !== undefined ? { per_session: over.per_session } : {}),
    };
  }

  check(ctx: BudgetCheckContext): PolicyDecision | null {
    const { agentType, instanceId, proposedCost } = ctx;
    const budget = this.budgetFor(agentType);

    if (budget.per_request !== undefined && proposedCost > budget.per_request) {
      const d = this.dollarOverrun("per_request", `Exceeds per-request limit of $${budget.per_request}`);
      if (d) return d;
    }

    if (budget.per_session !== undefined) {
      const sessionSpend = this.tracker.getInstanceSpend(instanceId);
      if (sessionSpend + proposedCost > budget.per_session) {
        const d = this.dollarOverrun(
          "per_session",
          `Exceeds session limit: $${sessionSpend.toFixed(2)} + $${proposedCost.toFixed(2)} > $${budget.per_session}`
        );
        if (d) return d;
      }
    }

    if (budget.daily !== undefined) {
      const dailySpend = this.tracker.getDailySpend(agentType);
      if (dailySpend + proposedCost > budget.daily) {
        const d = this.dollarOverrun(
          "daily",
          `Exceeds daily limit: $${dailySpend.toFixed(2)} + $${proposedCost.toFixed(2)} > $${budget.daily}`
        );
        if (d) return d;
      }
    }

    if (budget.monthly !== undefined) {
      const monthlySpend = this.tracker.getMonthlySpend(agentType);
      if (monthlySpend + proposedCost > budget.monthly) {
        const d = this.dollarOverrun(
          "monthly",
          `Exceeds monthly limit: $${monthlySpend.toFixed(2)} + $${proposedCost.toFixed(2)} > $${budget.monthly}`
        );
        if (d) return d;
      }
    }

    // alert_at percent thresholds on the cumulative dollar limits — fires
    // once per (limit, threshold, agent) as spend crosses each mark.
    if (budget.alert_at?.length && this.onAlert) {
      this.checkAlertThresholds(agentType, budget);
    }

    // Call-count limits: the runaway-loop guard. These enforce regardless of
    // cost attribution — every allowed call counts as one.
    const calls = budget.calls;
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
    const tokens = budget.result_tokens;
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

  private checkAlertThresholds(agentType: string, budget: BudgetConfig): void {
    const dims = [
      { name: "daily", limit: budget.daily, spend: this.tracker.getDailySpend(agentType) },
      { name: "monthly", limit: budget.monthly, spend: this.tracker.getMonthlySpend(agentType) },
    ];
    for (const d of dims) {
      if (d.limit === undefined || d.limit <= 0) continue;
      const pct = (d.spend / d.limit) * 100;
      for (const threshold of budget.alert_at ?? []) {
        if (pct < threshold) continue;
        const key = `alert_at:${d.name}:${threshold}:${agentType}`;
        if (this.alerted.has(key)) continue;
        this.alerted.add(key);
        this.onAlert?.(
          `Budget alert: ${agentType} ${d.name} spend $${d.spend.toFixed(2)} is ${Math.floor(pct)}% of $${d.limit} (alert_at ${threshold}%)`
        );
      }
    }
  }

  /** Dollar overrun → decision per on_exceed; warn alerts once per limit and lets the call through. */
  private dollarOverrun(limit: string, reason: string): PolicyDecision | null {
    // on_exceed is a global posture; per-agent overrides only carry amounts.
    const mode = this.globalBudget.on_exceed ?? "warn";
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
