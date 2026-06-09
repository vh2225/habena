/**
 * Static analysis over a resolved policy. Flags common authoring bugs
 * that the engine would happily execute but the user probably didn't
 * intend. Partner to `habena doctor` — doctor covers runtime
 * health, this covers policy shape.
 *
 * V1 checks: the ones from the Phase 9 spec that are pure local pattern
 * matching. Deferred: `unreachable-rule` (needs a subset matcher across
 * two Rule.match blocks), `require-approval-no-forwarder` (needs a live
 * queue to know who's subscribed).
 */

import type { AgentGuardConfig, Rule } from "./types.js";

export type AuditSeverity = "error" | "warning" | "info";

export interface AuditFinding {
  check: string;
  severity: AuditSeverity;
  message: string;
  /** Index into `userRules` if the finding points at a specific user rule. */
  userRuleIndex?: number;
  /** Index into `hostRules` if the finding points at a specific host rule. */
  hostRuleIndex?: number;
  /** Human-readable excerpt of the offending rule (tool + action). */
  ruleExcerpt?: string;
}

export interface AuditInput {
  config: AgentGuardConfig;
  hostRules?: Rule[];
}

export function auditPolicy(input: AuditInput): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const userRules = input.config.rules ?? [];
  const hostRules = input.hostRules ?? [];

  findings.push(...checkWildcardBeforeSpecific(userRules, "user"));
  findings.push(...checkWildcardBeforeSpecific(hostRules, "host"));
  findings.push(...checkOrphanServerReference(userRules, input.config));
  findings.push(...checkHostPolicyOverriddenAttempt(userRules, hostRules));

  return findings;
}

/**
 * `wildcard-before-specific` — a `tool: "*"` with `allow` appearing
 * before any specific `deny` in the same tier. First-match-wins means
 * the deny will never fire.
 */
function checkWildcardBeforeSpecific(rules: Rule[], tier: "user" | "host"): AuditFinding[] {
  const findings: AuditFinding[] = [];
  let firstWildcardAllowIdx = -1;
  rules.forEach((rule, i) => {
    if (firstWildcardAllowIdx === -1) {
      if (rule.match.tool === "*" && normalizedAction(rule) === "allow") {
        firstWildcardAllowIdx = i;
      }
      return;
    }
    const action = normalizedAction(rule);
    if (action === "deny" || action === "require_approval") {
      findings.push({
        check: "wildcard-before-specific",
        severity: "warning",
        message:
          `${tier} rule #${i} (${rule.match.tool ?? "—"}: ${rule.action}) is unreachable: ` +
          `rule #${firstWildcardAllowIdx} above already matches every tool with allow. ` +
          `Move the specific rule above the wildcard.`,
        [tier === "user" ? "userRuleIndex" : "hostRuleIndex"]: i,
        ruleExcerpt: excerpt(rule),
      });
    }
  });
  return findings;
}

/**
 * `orphan-server-reference` — a rule matches `server: <name>` but that
 * name isn't in `mcp_servers:`. Usually a typo.
 */
function checkOrphanServerReference(
  rules: Rule[],
  config: AgentGuardConfig
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const servers = new Set(Object.keys(config.mcp_servers ?? {}));
  rules.forEach((rule, i) => {
    const m = rule.match as unknown as { server?: string };
    if (!m.server) return;
    if (servers.has(m.server)) return;
    findings.push({
      check: "orphan-server-reference",
      severity: "warning",
      message:
        `user rule #${i} matches server="${m.server}" but no such server is configured in mcp_servers. ` +
        `This rule will never fire. Typo, or did you forget to add the downstream?`,
      userRuleIndex: i,
      ruleExcerpt: excerpt(rule),
    });
  });
  return findings;
}

/**
 * `host-policy-overridden-attempt` — a user rule that tries to weaken
 * a host rule (allow where host says deny, or allow where host says
 * require_approval). Not actually dangerous (engine enforces
 * stricter-of-two), but the user is probably confused.
 */
function checkHostPolicyOverriddenAttempt(
  userRules: Rule[],
  hostRules: Rule[]
): AuditFinding[] {
  if (hostRules.length === 0) return [];
  const findings: AuditFinding[] = [];
  userRules.forEach((uRule, i) => {
    const uAction = normalizedAction(uRule);
    if (uAction !== "allow") return;
    for (const hRule of hostRules) {
      const hAction = normalizedAction(hRule);
      if (hAction === "allow") continue;
      if (sameToolPattern(uRule, hRule)) {
        findings.push({
          check: "host-policy-overridden-attempt",
          severity: "info",
          message:
            `user rule #${i} allows "${uRule.match.tool}", but host-policy.yaml ${hAction}s the same pattern. ` +
            `The host floor wins — this user rule has no effect.`,
          userRuleIndex: i,
          ruleExcerpt: excerpt(uRule),
        });
        return; // first match is enough
      }
    }
  });
  return findings;
}

function normalizedAction(rule: Rule): "allow" | "deny" | "require_approval" {
  if (rule.action === "deny_unless" || rule.action === "deny_if") return "deny";
  return rule.action;
}

function sameToolPattern(a: Rule, b: Rule): boolean {
  if (!a.match.tool || !b.match.tool) return false;
  return a.match.tool === b.match.tool;
}

function excerpt(rule: Rule): string {
  const parts: string[] = [];
  if (rule.match.tool) parts.push(`tool=${rule.match.tool}`);
  const serverMatch = (rule.match as unknown as { server?: string }).server;
  if (serverMatch) parts.push(`server=${serverMatch}`);
  parts.push(`action=${rule.action}`);
  if (rule.enforcement) parts.push(`enforcement=${rule.enforcement}`);
  return parts.join(" ");
}
