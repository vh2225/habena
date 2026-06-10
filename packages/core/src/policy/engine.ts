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

import { randomUUID } from "node:crypto";
import { matches, fieldsMatch, type ToolCallContext } from "./matcher.js";
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
  id: string;
  rule: Rule;
  expiresAt: Date;
}

/** Operator-visible view of an active session override. */
export interface SessionOverrideView {
  id: string;
  tool: string;
  reason: string;
  expiresAt: Date;
}

export class PolicyEngine {
  private userRules: Rule[];
  private hostRules: Rule[];
  private sessionOverrides: SessionOverride[] = [];
  private lockdown = false;

  constructor(userRules: Rule[] = [], hostRules: Rule[] = []) {
    this.userRules = userRules;
    this.hostRules = hostRules;
  }

  /** Panic button: deny every call until released. Outranks everything. */
  setLockdown(on: boolean): void {
    this.lockdown = on;
  }

  isLockdown(): boolean {
    return this.lockdown;
  }

  evaluate(call: ToolCallContext): PolicyDecision {
    // 0. Lockdown — the operator's kill switch, above every tier.
    if (this.lockdown) {
      return {
        action: "deny",
        reason: "Lockdown active — all tool calls denied until the operator releases it",
        tool: call.tool,
        enforcement: "hard_mandatory",
        risk_level: "critical",
        tier: "built_in",
      };
    }

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

  addSessionOverride(rule: Rule, expiresAt: Date): string {
    const id = randomUUID();
    this.sessionOverrides.push({ id, rule, expiresAt });
    return id;
  }

  /** Active (non-expired) session overrides, for operator inspection. */
  listSessionOverrides(): SessionOverrideView[] {
    this.clearExpiredOverrides();
    return this.sessionOverrides.map((o) => ({
      id: o.id,
      tool: o.rule.match.tool ?? "*",
      reason: o.rule.reason ?? "session approval",
      expiresAt: o.expiresAt,
    }));
  }

  /** Revoke a session override before it expires. Returns false if unknown. */
  revokeSessionOverride(id: string): boolean {
    const before = this.sessionOverrides.length;
    this.sessionOverrides = this.sessionOverrides.filter((o) => o.id !== id);
    return this.sessionOverrides.length < before;
  }

  clearExpiredOverrides(): void {
    // Strictly greater-than: an override with expiresAt === now is treated as expired.
    const now = Date.now();
    this.sessionOverrides = this.sessionOverrides.filter(
      (o) => o.expiresAt.getTime() > now
    );
  }

  private toDecision(rule: Rule, tier: RuleTier, call: ToolCallContext): PolicyDecision {
    const action: ActionType = resolveAction(rule, call);
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

/** Condition fields the matcher can actually evaluate at call time. The
 * reserved Phase-2 fields (glama_grade, url_not_in, body_contains_file_content)
 * are NOT here: a condition using them cannot be evaluated yet. */
const EVALUABLE_CONDITION_FIELDS = new Set([
  "tool", "tool_tag", "args_contain", "command_matches", "path_starts_with", "registry",
]);

/**
 * Resolves conditional actions against the call. The `condition` block uses
 * the same field vocabulary as `match`:
 *   - deny_unless: allow when the condition holds, deny otherwise.
 *   - deny_if:     deny when the condition holds, allow otherwise.
 * A matched conditional rule always produces a decision (first-match-wins
 * still applies) — it never falls through to later rules.
 * Fail closed (deny) when the condition is missing, empty, or contains any
 * field the matcher cannot evaluate — partially evaluating a condition would
 * make deny_unless fail open.
 */
function resolveAction(rule: Rule, call: ToolCallContext): ActionType {
  if (rule.action !== "deny_unless" && rule.action !== "deny_if") return rule.action;
  const cond = rule.condition;
  if (!cond || Object.keys(cond).length === 0) return "deny";
  if (Object.keys(cond).some((k) => !EVALUABLE_CONDITION_FIELDS.has(k))) return "deny";
  const holds = fieldsMatch(cond, call);
  if (rule.action === "deny_unless") return holds ? "allow" : "deny";
  return holds ? "deny" : "allow";
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
