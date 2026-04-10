/**
 * 3-tier policy engine with deny-overrides-allow semantics.
 *
 * Evaluation order (first match wins within each tier):
 *   1. Hard boundaries (built-in, never overridable)
 *   2. Session overrides (temporary, from human approvals)
 *   3. User rules (from agentguard.yaml)
 *   4. Default rules (built-in soft defaults)
 *   5. Implicit deny (fail-safe)
 */

import { matches, type ToolCallContext } from "./matcher.js";
import { HARD_BOUNDARIES, DEFAULTS } from "./built-in-rules.js";
import type { Rule } from "./types.js";
import type {
  PolicyDecision,
  ActionType,
  EnforcementLevel,
  RiskLevel,
  RuleTier,
} from "./decisions.js";

interface SessionOverride {
  rule: Rule;
  expiresAt: Date;
}

export class PolicyEngine {
  private userRules: Rule[];
  private sessionOverrides: SessionOverride[] = [];

  constructor(userRules: Rule[] = []) {
    this.userRules = userRules;
  }

  evaluate(call: ToolCallContext): PolicyDecision {
    // 1. Hard boundaries ALWAYS win
    for (const rule of HARD_BOUNDARIES) {
      if (matches(rule, call)) {
        return this.toDecision(rule, "built_in", call);
      }
    }

    // 2. Check active session overrides (first match wins)
    this.clearExpiredOverrides();
    for (const override of this.sessionOverrides) {
      if (matches(override.rule, call)) {
        return this.toDecision(override.rule, "session", call);
      }
    }

    // 3. Check user rules (first match wins in declared order)
    for (const rule of this.userRules) {
      if (matches(rule, call)) {
        return this.toDecision(rule, "user", call);
      }
    }

    // 4. Fall back to defaults
    for (const rule of DEFAULTS) {
      if (matches(rule, call)) {
        return this.toDecision(rule, "built_in", call);
      }
    }

    // 5. Implicit deny (fail-safe)
    return {
      action: "deny",
      reason: "No matching rule — implicit deny",
      tool: call.tool,
      enforcement: "soft_mandatory",
      risk_level: "medium",
      tier: "built_in",
    };
  }

  addSessionOverride(rule: Rule, expiresAt: Date): void {
    this.sessionOverrides.push({ rule, expiresAt });
  }

  clearExpiredOverrides(): void {
    const now = Date.now();
    this.sessionOverrides = this.sessionOverrides.filter(
      (o) => o.expiresAt.getTime() > now
    );
  }

  private toDecision(rule: Rule, tier: RuleTier, call: ToolCallContext): PolicyDecision {
    const action: ActionType = normalizeAction(rule.action);
    const enforcement: EnforcementLevel = rule.enforcement ?? "soft_mandatory";
    const risk_level: RiskLevel = enforcement === "hard_mandatory" ? "critical" : "medium";

    return {
      action,
      reason: rule.reason ?? `${tier} rule`,
      tool: call.tool,
      enforcement,
      risk_level,
      tier,
    };
  }
}

function normalizeAction(action: Rule["action"]): ActionType {
  // deny_unless / deny_if are treated as plain deny in Phase 1 (condition
  // evaluation is deferred to Phase 2 — the engine does not yet interpret
  // the `condition` field on rules).
  if (action === "deny_unless" || action === "deny_if") return "deny";
  return action;
}
