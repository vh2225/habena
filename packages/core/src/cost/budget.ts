/**
 * Budget enforcement — hard_mandatory, cannot be overridden.
 */

import type { CostTracker } from "./tracker.js";
import type { PolicyDecision } from "../policy/decisions.js";

export function enforceBudget(
  tracker: CostTracker,
  agent: string,
  sessionId: string,
  proposedCost: number
): PolicyDecision | null {
  const result = tracker.checkBudget(agent, sessionId, proposedCost);

  if (!result.allowed) {
    return {
      action: "deny",
      reason: result.reason ?? "Budget limit exceeded",
      tool: "*",
      enforcement: "hard_mandatory",
      risk_level: "critical",
      tier: "built_in",
    };
  }

  return null; // No budget issue, proceed with normal policy evaluation
}
