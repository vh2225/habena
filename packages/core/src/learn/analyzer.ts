import Database from "better-sqlite3";
import type { Rule } from "../policy/types.js";

export interface ToolObservation {
  /** Stable key: `<agentType>::<tool>` */
  key: string;
  agentType: string;
  tool: string;
  total: number;
  allowed: number;
  denied: number;
  requiredApproval: number;
  /** Unique tier labels seen (useful for noticing repeated hard-boundary hits). */
  tiers: string[];
  /** First and last time this shape was observed, in the window. */
  firstSeen: Date;
  lastSeen: Date;
}

export interface Suggestion {
  rule: Rule;
  /** Why this rule was suggested — shown to the user next to the rule. */
  rationale: string;
  /** What the observation that produced this suggestion looked like. */
  observation: ToolObservation;
}

export interface LearnOptions {
  /** Only consider entries newer than this many days ago (default 14). */
  sinceDays?: number;
  /** Filter to a single agent type. */
  agentType?: string;
  /** Minimum observation count required before a tool is suggested for allow. */
  minObservationsForAllow?: number;
}

/**
 * Read the audit DB and bucket every tool call by (agent_type, tool).
 * Pure function — no writes, no side effects, safe to run against a
 * live DB (better-sqlite3 opens with shared locks).
 */
export function observe(dbPath: string, options: LearnOptions = {}): ToolObservation[] {
  const sinceDays = options.sinceDays ?? 14;
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();

  const db = new Database(dbPath, { readonly: true });
  try {
    // If the table doesn't exist yet (fresh install), return an empty result.
    const tableRow = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_entries'")
      .get();
    if (!tableRow) return [];

    const where: string[] = ["timestamp >= ?"];
    const params: unknown[] = [since];
    if (options.agentType) {
      where.push("agent_type = ?");
      params.push(options.agentType);
    }

    const rows = db
      .prepare(
        `SELECT agent_type, tool, decision, tier, timestamp FROM audit_entries WHERE ${where.join(" AND ")}`
      )
      .all(...params) as Array<{
      agent_type: string;
      tool: string;
      decision: string;
      tier: string;
      timestamp: string;
    }>;

    const buckets = new Map<string, ToolObservation>();
    for (const r of rows) {
      const key = `${r.agent_type}::${r.tool}`;
      let b = buckets.get(key);
      if (!b) {
        const ts = new Date(r.timestamp);
        b = {
          key,
          agentType: r.agent_type,
          tool: r.tool,
          total: 0,
          allowed: 0,
          denied: 0,
          requiredApproval: 0,
          tiers: [],
          firstSeen: ts,
          lastSeen: ts,
        };
        buckets.set(key, b);
      }
      b.total += 1;
      if (r.decision === "allow") b.allowed += 1;
      else if (r.decision === "deny") b.denied += 1;
      else if (r.decision === "require_approval") b.requiredApproval += 1;
      if (!b.tiers.includes(r.tier)) b.tiers.push(r.tier);
      const ts = new Date(r.timestamp);
      if (ts < b.firstSeen) b.firstSeen = ts;
      if (ts > b.lastSeen) b.lastSeen = ts;
    }

    return [...buckets.values()].sort((a, b) => b.total - a.total);
  } finally {
    db.close();
  }
}

/**
 * Turn observations into concrete rule suggestions. Intentionally
 * conservative: only suggests `allow` when a tool has been consistently
 * allowed many times. Suggests `deny` when denies dominate. Suggests
 * `require_approval` for ambiguous cases.
 */
export function propose(
  observations: ToolObservation[],
  options: LearnOptions = {}
): Suggestion[] {
  const minAllow = options.minObservationsForAllow ?? 10;
  const out: Suggestion[] = [];
  for (const o of observations) {
    const denyRate = o.denied / Math.max(1, o.total);
    const allowRate = o.allowed / Math.max(1, o.total);
    const tier = o.tiers.includes("built_in") ? "built_in" : null;

    // Never weaken a built-in / hard-boundary match; just note it.
    if (tier === "built_in" && o.denied > 0) continue;

    if (o.denied > 0 && denyRate >= 0.8 && o.allowed === 0) {
      out.push({
        rule: {
          match: { tool: o.tool },
          action: "deny",
          enforcement: "soft_mandatory",
          reason: `Observed ${o.denied}/${o.total} denied over the window`,
        },
        rationale: `${o.tool} was denied ${o.denied} of ${o.total} times and never allowed. Codify as deny.`,
        observation: o,
      });
      continue;
    }
    if (allowRate >= 0.95 && o.total >= minAllow && o.denied === 0) {
      out.push({
        rule: {
          match: { tool: o.tool },
          action: "allow",
          reason: `Observed ${o.allowed}/${o.total} allowed cleanly over the window`,
        },
        rationale: `${o.tool} ran ${o.allowed} times without a deny. Safe to auto-allow.`,
        observation: o,
      });
      continue;
    }
    if (o.total >= 3) {
      out.push({
        rule: {
          match: { tool: o.tool },
          action: "require_approval",
          enforcement: "soft_mandatory",
          reason: `Mixed outcomes: ${o.allowed} allowed / ${o.denied} denied / ${o.requiredApproval} approved`,
        },
        rationale: `${o.tool} has mixed history — keep a human in the loop.`,
        observation: o,
      });
    }
  }
  return out;
}
