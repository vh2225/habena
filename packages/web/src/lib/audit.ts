import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { configDir, expandHome } from "./config-dir";
import type { AgentActivity } from "./agents";

export interface DecisionRow {
  id: number;
  timestamp: string;
  agentType: string;
  instanceId: string;
  tool: string;
  mcpServer: string;
  decision: string;
  tier: string;
  ruleMatched: string | null;
  reason: string | null;
  latencyMs: number | null;
  resultStatus: string;
  /** First 2KB of the call args (raw JSON text) — enough to see what the
   * agent tried without shipping multi-MB payloads on every poll. */
  argsPreview: string | null;
}

export interface AuditSummary {
  totalDecisions: number;
  allowed: number;
  denied: number;
  approvalPending: number;
  /** Decisions flagged by the threat engine (reason contains "threat:"). */
  threats: number;
  byAgent: Array<{ agentType: string; count: number }>;
  byTool: Array<{ tool: string; count: number }>;
}

function dbPath(): string {
  const override = process.env.HABENA_AUDIT_DB ?? process.env.AGENTGUARD_AUDIT_DB;
  if (override && override.trim() !== "") return expandHome(override.trim());
  return join(configDir(), "audit.db");
}

function openReadOnly(): Database.Database | null {
  const p = dbPath();
  if (!existsSync(p)) return null;
  return new Database(p, { readonly: true, fileMustExist: true });
}

export function recentDecisions(limit: number = 100): DecisionRow[] {
  const db = openReadOnly();
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT id, timestamp, agent_type, instance_id, tool, mcp_server,
                decision, tier, rule_matched, reason, latency_ms, result_status,
                substr(args, 1, 2048) AS args_preview, length(args) AS args_len
         FROM audit_entries
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      timestamp: r.timestamp as string,
      agentType: r.agent_type as string,
      instanceId: r.instance_id as string,
      tool: r.tool as string,
      mcpServer: r.mcp_server as string,
      decision: r.decision as string,
      tier: r.tier as string,
      ruleMatched: (r.rule_matched as string | null) ?? null,
      reason: (r.reason as string | null) ?? null,
      latencyMs: (r.latency_ms as number | null) ?? null,
      resultStatus: r.result_status as string,
      argsPreview:
        typeof r.args_preview === "string"
          ? r.args_preview + ((r.args_len as number) > 2048 ? "…" : "")
          : null,
    }));
  } finally {
    db.close();
  }
}

export function summary(): AuditSummary {
  const db = openReadOnly();
  if (!db) {
    return { totalDecisions: 0, allowed: 0, denied: 0, approvalPending: 0, threats: 0, byAgent: [], byTool: [] };
  }
  try {
    const total = (db.prepare(`SELECT COUNT(*) c FROM audit_entries`).get() as { c: number }).c;
    const allowed = (db.prepare(`SELECT COUNT(*) c FROM audit_entries WHERE decision = 'allow'`).get() as { c: number }).c;
    const denied = (db.prepare(`SELECT COUNT(*) c FROM audit_entries WHERE decision = 'deny'`).get() as { c: number }).c;
    const approvalPending = (db.prepare(`SELECT COUNT(*) c FROM audit_entries WHERE decision = 'require_approval'`).get() as { c: number }).c;
    // Substring, not prefix: approval-resolved reasons read "approved: threat:…".
    const threats = (db.prepare(`SELECT COUNT(*) c FROM audit_entries WHERE reason LIKE '%threat:%'`).get() as { c: number }).c;
    const byAgent = db
      .prepare(
        `SELECT agent_type, COUNT(*) c FROM audit_entries GROUP BY agent_type ORDER BY c DESC LIMIT 10`
      )
      .all() as Array<{ agent_type: string; c: number }>;
    const byTool = db
      .prepare(
        `SELECT tool, COUNT(*) c FROM audit_entries GROUP BY tool ORDER BY c DESC LIMIT 10`
      )
      .all() as Array<{ tool: string; c: number }>;
    return {
      totalDecisions: total,
      allowed,
      denied,
      approvalPending,
      threats,
      byAgent: byAgent.map((r) => ({ agentType: r.agent_type, count: r.c })),
      byTool: byTool.map((r) => ({ tool: r.tool, count: r.c })),
    };
  } finally {
    db.close();
  }
}

export function agentActivity(): AgentActivity[] {
  const db = openReadOnly();
  if (!db) return [];
  try {
    const decisionRows = db
      .prepare(`SELECT agent_type, decision, COUNT(*) c FROM audit_entries GROUP BY agent_type, decision`)
      .all() as Array<{ agent_type: string; decision: string; c: number }>;
    const toolRows = db
      .prepare(`SELECT agent_type, tool, COUNT(*) c FROM audit_entries GROUP BY agent_type, tool`)
      .all() as Array<{ agent_type: string; tool: string; c: number }>;
    const instRows = db
      .prepare(`SELECT agent_type, COUNT(DISTINCT instance_id) c FROM audit_entries GROUP BY agent_type`)
      .all() as Array<{ agent_type: string; c: number }>;
    const seenRows = db
      .prepare(`SELECT agent_type, MAX(timestamp) ts FROM audit_entries GROUP BY agent_type`)
      .all() as Array<{ agent_type: string; ts: string }>;

    const map = new Map<string, AgentActivity>();
    const get = (t: string): AgentActivity => {
      let a = map.get(t);
      if (!a) {
        a = { agentType: t, total: 0, allow: 0, deny: 0, approval: 0, topTools: [], instancesSeen: 0, lastSeen: null };
        map.set(t, a);
      }
      return a;
    };

    for (const r of decisionRows) {
      const a = get(r.agent_type);
      a.total += r.c;
      if (r.decision === "allow") a.allow += r.c;
      else if (r.decision === "deny") a.deny += r.c;
      else if (r.decision === "require_approval") a.approval += r.c;
    }
    const tools = new Map<string, { tool: string; count: number }[]>();
    for (const r of toolRows) {
      const list = tools.get(r.agent_type) ?? [];
      list.push({ tool: r.tool, count: r.c });
      tools.set(r.agent_type, list);
    }
    for (const [t, list] of tools) {
      get(t).topTools = list.sort((x, y) => y.count - x.count).slice(0, 5);
    }
    for (const r of instRows) get(r.agent_type).instancesSeen = r.c;
    for (const r of seenRows) get(r.agent_type).lastSeen = r.ts ?? null;

    return Array.from(map.values());
  } finally {
    db.close();
  }
}

export interface SpendSummary {
  /** Allowed calls since local midnight. */
  callsToday: number;
  /** Sum of declared-pricing cost (USD) since local midnight — NOT measured LLM spend. */
  costToday: number;
  callsLastHour: number;
  /** Estimated tokens of tool results injected into agent context today
   * (from the proxy's result_meter; 0 when the table is absent or empty). */
  resultTokensToday: number;
  byAgent: Array<{ agentType: string; calls: number; cost: number }>;
  byTool: Array<{ tool: string; calls: number; cost: number }>;
  /** 24 buckets, oldest first; hourIso is the UTC hour prefix (YYYY-MM-DDTHH). */
  hourly: Array<{ hourIso: string; calls: number; cost: number }>;
}

function emptySpend(): SpendSummary {
  return { callsToday: 0, costToday: 0, callsLastHour: 0, resultTokensToday: 0, byAgent: [], byTool: [], hourly: emptyHourly() };
}

function emptyHourly(): SpendSummary["hourly"] {
  const out: SpendSummary["hourly"] = [];
  const now = Date.now();
  for (let i = 23; i >= 0; i--) {
    const hourIso = new Date(now - i * 3_600_000).toISOString().slice(0, 13);
    out.push({ hourIso, calls: 0, cost: 0 });
  }
  return out;
}

/** Activity + declared-pricing spend, from allowed audit entries only. */
export function spendSummary(): SpendSummary {
  const db = openReadOnly();
  if (!db) return emptySpend();
  try {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const midnightIso = midnight.toISOString();
    const hourAgoIso = new Date(Date.now() - 3_600_000).toISOString();
    const dayAgoIso = new Date(Date.now() - 24 * 3_600_000).toISOString();

    const today = db
      .prepare(`SELECT COUNT(*) c, COALESCE(SUM(cost), 0) s FROM audit_entries WHERE decision = 'allow' AND timestamp >= ?`)
      .get(midnightIso) as { c: number; s: number };
    const lastHour = db
      .prepare(`SELECT COUNT(*) c FROM audit_entries WHERE decision = 'allow' AND timestamp >= ?`)
      .get(hourAgoIso) as { c: number };
    // result_meter only exists in DBs written by habena >= 0.4 — treat absence as zero.
    let resultTokensToday = 0;
    try {
      resultTokensToday = (
        db.prepare(`SELECT COALESCE(SUM(tokens), 0) s FROM result_meter WHERE timestamp >= ?`).get(midnightIso) as { s: number }
      ).s;
    } catch {
      /* table absent — older proxy wrote this DB */
    }
    const byAgent = db
      .prepare(
        `SELECT agent_type, COUNT(*) c, COALESCE(SUM(cost), 0) s FROM audit_entries
         WHERE decision = 'allow' AND timestamp >= ? GROUP BY agent_type ORDER BY c DESC LIMIT 10`
      )
      .all(midnightIso) as Array<{ agent_type: string; c: number; s: number }>;
    const byTool = db
      .prepare(
        `SELECT tool, COUNT(*) c, COALESCE(SUM(cost), 0) s FROM audit_entries
         WHERE decision = 'allow' AND timestamp >= ? GROUP BY tool ORDER BY c DESC LIMIT 10`
      )
      .all(midnightIso) as Array<{ tool: string; c: number; s: number }>;
    const hourRows = db
      .prepare(
        `SELECT substr(timestamp, 1, 13) h, COUNT(*) c, COALESCE(SUM(cost), 0) s FROM audit_entries
         WHERE decision = 'allow' AND timestamp >= ? GROUP BY h`
      )
      .all(dayAgoIso) as Array<{ h: string; c: number; s: number }>;

    const hourly = emptyHourly();
    const byHour = new Map(hourRows.map((r) => [r.h, r]));
    for (const bucket of hourly) {
      const row = byHour.get(bucket.hourIso);
      if (row) {
        bucket.calls = row.c;
        bucket.cost = row.s;
      }
    }

    return {
      callsToday: today.c,
      costToday: today.s,
      callsLastHour: lastHour.c,
      resultTokensToday,
      byAgent: byAgent.map((r) => ({ agentType: r.agent_type, calls: r.c, cost: r.s })),
      byTool: byTool.map((r) => ({ tool: r.tool, calls: r.c, cost: r.s })),
      hourly,
    };
  } finally {
    db.close();
  }
}

export interface ThreatGroup {
  mcpServer: string;
  tool: string;
  detector: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  lastReason: string;
  /** Outcome mix: blocked vs human-approved vs warn-allowed. */
  denied: number;
  allowed: number;
  escalated: number;
}

export interface ThreatSummary {
  totalEvents: number;
  eventsToday: number;
  byDetector: Array<{ detector: string; count: number }>;
  groups: ThreatGroup[];
}

/** Extract the detector id from a `…threat:<detector>: …` reason. */
function detectorOf(reason: string): string {
  const m = /threat:([a-z_]+)/.exec(reason);
  return m ? m[1] : "unknown";
}

/** Threat events grouped by (server, tool, detector), newest activity first. */
export function threatSummary(): ThreatSummary {
  const db = openReadOnly();
  if (!db) return { totalEvents: 0, eventsToday: 0, byDetector: [], groups: [] };
  try {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const rows = db
      .prepare(
        `SELECT timestamp, tool, mcp_server, decision, reason FROM audit_entries
         WHERE reason LIKE '%threat:%' ORDER BY id DESC LIMIT 5000`
      )
      .all() as Array<{ timestamp: string; tool: string; mcp_server: string; decision: string; reason: string }>;

    const groups = new Map<string, ThreatGroup>();
    const byDetector = new Map<string, number>();
    let eventsToday = 0;
    const midnightIso = midnight.toISOString();

    for (const r of rows) {
      const detector = detectorOf(r.reason);
      byDetector.set(detector, (byDetector.get(detector) ?? 0) + 1);
      if (r.timestamp >= midnightIso) eventsToday++;

      const key = `${r.mcp_server}|${r.tool}|${detector}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          mcpServer: r.mcp_server, tool: r.tool, detector,
          count: 0, firstSeen: r.timestamp, lastSeen: r.timestamp, lastReason: r.reason,
          denied: 0, allowed: 0, escalated: 0,
        };
        groups.set(key, g);
      }
      g.count++;
      // Rows arrive newest-first: the first row seen per group is its latest.
      if (r.timestamp < g.firstSeen) g.firstSeen = r.timestamp;
      if (r.timestamp > g.lastSeen) {
        g.lastSeen = r.timestamp;
        g.lastReason = r.reason;
      }
      if (r.decision === "deny") g.denied++;
      else if (r.decision === "allow") g.allowed++;
      else g.escalated++;
    }

    return {
      totalEvents: rows.length,
      eventsToday,
      byDetector: Array.from(byDetector.entries())
        .map(([detector, count]) => ({ detector, count }))
        .sort((a, b) => b.count - a.count),
      groups: Array.from(groups.values()).sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1)),
    };
  } finally {
    db.close();
  }
}

export function dbExists(): boolean {
  return existsSync(dbPath());
}

export function dbPathForDisplay(): string {
  return dbPath();
}
