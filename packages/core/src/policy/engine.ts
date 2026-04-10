/**
 * Policy engine — evaluates tool calls against rules.
 *
 * Evaluation order (AWS IAM + Cloudflare patterns):
 * 1. Start with implicit DENY for destructive actions
 * 2. Evaluate ALLOW rules (most specific match wins)
 * 3. Evaluate explicit DENY rules (always override allows)
 * 4. Hard boundaries can NEVER be overridden
 *
 * Three-tier rule system:
 * - Tier 1: Built-in rules (shipped with AgentGuard)
 * - Tier 2: User rules (agentguard.yaml)
 * - Tier 3: Session overrides (from human approvals, auto-expire)
 */

import type { PolicyDecision } from "./decisions.js";
import type { Rule, AgentGuardConfig } from "./parser.js";

export interface ToolCallContext {
  agent: string;
  sessionId: string;
  tool: string;
  args: Record<string, unknown>;
  mcpServer: string;
  registry?: string;
  glamaGrade?: string;
  sessionCost: number;
}

export class PolicyEngine {
  private builtInRules: Rule[] = [];
  private userRules: Rule[] = [];
  private sessionOverrides: Rule[] = [];

  constructor(configPath: string) {
    // TODO: Load built-in rules + parse user config
  }

  evaluate(ctx: ToolCallContext): PolicyDecision {
    // TODO: Implement 3-tier evaluation with deny-overrides-allow
    throw new Error("Not implemented");
  }

  addSessionOverride(rule: Rule, expiresAt: Date): void {
    // TODO: Add temporary rule from human approval
  }

  clearExpiredOverrides(): void {
    // TODO: Remove expired session overrides
  }
}
