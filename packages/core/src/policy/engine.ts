/**
 * Policy engine with host-policy floor (Phase 8 V3).
 *
 * Evaluation strategy:
 *   - Tier precedence: hard boundaries → session overrides →
 *     {host ∧ user merged stricter-of-two} → defaults → implicit deny.
 *   - Within a tier, rules use **first-match-wins**. Same model as
 *     Cloudflare WAF / iptables / AWS security groups.
 *   - Hard boundaries always win, regardless of session overrides or
 *     user rules. One non-negotiable security guarantee.
 *   - Session overrides CAN bypass user denies (explicit human
 *     approval). They CANNOT bypass hard boundaries or host-policy.
 *   - Host-policy is a floor: when both a host rule and a user rule
 *     match the same call, the stricter one wins (deny > require_approval
 *     > allow; hard_mandatory > soft_mandatory > advisory; ties go to
 *     host). A user config cannot weaken a host-policy deny.
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
  private hostRules: Rule[];
  private sessionOverrides: SessionOverride[] = [];

  constructor(userRules: Rule[] = [], hostRules: Rule[] = []) {
    this.userRules = userRules;
    this.hostRules = hostRules;
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

    // 3. Host-policy floor + user rules — stricter-of-two merge
    const hostDecision = this.firstMatch(this.hostRules, "host", call);
    const userDecision = this.firstMatch(this.userRules, "user", call);
    if (hostDecision && userDecision) return stricter(hostDecision, userDecision);
    if (hostDecision) return hostDecision;
    if (userDecision) return userDecision;

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

  private firstMatch(rules: Rule[], tier: RuleTier, call: ToolCallContext): PolicyDecision | null {
    for (const rule of rules) {
      if (matches(rule, call)) return this.toDecision(rule, tier, call);
    }
    return null;
  }

  addSessionOverride(rule: Rule, expiresAt: Date): void {
    this.sessionOverrides.push({ rule, expiresAt });
  }

  clearExpiredOverrides(): void {
    // Strictly greater-than: an override with expiresAt === now is treated as expired.
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

const ACTION_STRICTNESS: Record<ActionType, number> = {
  deny: 3,
  require_approval: 2,
  allow: 1,
};
const ENFORCEMENT_STRICTNESS: Record<EnforcementLevel, number> = {
  hard_mandatory: 3,
  soft_mandatory: 2,
  advisory: 1,
};

/**
 * Pick the more restrictive of two decisions. Ordering:
 *   1. action strictness: deny > require_approval > allow
 *   2. enforcement strictness: hard_mandatory > soft_mandatory > advisory
 *   3. tie-break: host wins over user (host-policy is the floor)
 */
export function stricter(a: PolicyDecision, b: PolicyDecision): PolicyDecision {
  if (ACTION_STRICTNESS[a.action] !== ACTION_STRICTNESS[b.action]) {
    return ACTION_STRICTNESS[a.action] > ACTION_STRICTNESS[b.action] ? a : b;
  }
  if (ENFORCEMENT_STRICTNESS[a.enforcement] !== ENFORCEMENT_STRICTNESS[b.enforcement]) {
    return ENFORCEMENT_STRICTNESS[a.enforcement] > ENFORCEMENT_STRICTNESS[b.enforcement] ? a : b;
  }
  return a.tier === "host" ? a : b;
}
