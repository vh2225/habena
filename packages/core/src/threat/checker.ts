/**
 * Checks tool calls against the local threat feed.
 * Returns a threat assessment for each call.
 */

import type { ThreatFeedManager, ThreatEntry } from "./feed.js";
import type { PolicyDecision } from "../policy/decisions.js";

export interface ThreatCheckResult {
  clean: boolean;
  matchedThreats: ThreatEntry[];
}

export class ThreatChecker {
  constructor(private feedManager: ThreatFeedManager) {}

  check(mcpServer: string, tool: string, args: Record<string, unknown>): ThreatCheckResult {
    const entries = this.feedManager.getEntries();
    const matched: ThreatEntry[] = [];

    for (const entry of entries) {
      if (entry.expiresAt && new Date() > entry.expiresAt) continue;

      if (entry.type === "blocklisted_server" && entry.target === mcpServer) {
        matched.push(entry);
      }

      if (entry.type === "pattern" && entry.pattern) {
        const regex = new RegExp(entry.pattern);
        const argsStr = JSON.stringify(args);
        if (regex.test(argsStr)) {
          matched.push(entry);
        }
      }
    }

    return { clean: matched.length === 0, matchedThreats: matched };
  }

  toDecision(result: ThreatCheckResult, tool: string): PolicyDecision | null {
    if (result.clean) return null;

    const worst = result.matchedThreats.reduce((a, b) =>
      severityRank(a.severity) > severityRank(b.severity) ? a : b
    );

    return {
      action: worst.severity === "critical" ? "deny" : "require_approval",
      reason: `Threat feed: ${worst.description}`,
      tool,
      enforcement: worst.severity === "critical" ? "hard_mandatory" : "soft_mandatory",
      risk_level: worst.severity === "low" ? "medium" : worst.severity,
      tier: "built_in",
    };
  }
}

function severityRank(s: string): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[s] ?? 0;
}
