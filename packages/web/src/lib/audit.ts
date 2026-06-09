import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
}

export interface AuditSummary {
  totalDecisions: number;
  allowed: number;
  denied: number;
  approvalPending: number;
  byAgent: Array<{ agentType: string; count: number }>;
  byTool: Array<{ tool: string; count: number }>;
}

// Mirror packages/core's config-dir resolution: prefer ~/.habena, fall back
// to a legacy ~/.agentguard so the dashboard reads the same audit.db the
// proxy writes. (The web package can't import core, so this is duplicated —
// keep the `~` expansion identical to core's expandHome().)
function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  if (p === "~") return homedir();
  return p;
}

function configDir(): string {
  const override = process.env.HABENA_CONFIG_DIR ?? process.env.AGENTGUARD_CONFIG_DIR;
  if (override && override.trim() !== "") return expandHome(override.trim());
  const habena = join(homedir(), ".habena");
  if (existsSync(habena)) return habena;
  const legacy = join(homedir(), ".agentguard");
  if (existsSync(legacy)) return legacy;
  return habena;
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
                decision, tier, rule_matched, reason, latency_ms, result_status
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
    }));
  } finally {
    db.close();
  }
}

export function summary(): AuditSummary {
  const db = openReadOnly();
  if (!db) {
    return { totalDecisions: 0, allowed: 0, denied: 0, approvalPending: 0, byAgent: [], byTool: [] };
  }
  try {
    const total = (db.prepare(`SELECT COUNT(*) c FROM audit_entries`).get() as { c: number }).c;
    const allowed = (db.prepare(`SELECT COUNT(*) c FROM audit_entries WHERE decision = 'allow'`).get() as { c: number }).c;
    const denied = (db.prepare(`SELECT COUNT(*) c FROM audit_entries WHERE decision = 'deny'`).get() as { c: number }).c;
    const approvalPending = (db.prepare(`SELECT COUNT(*) c FROM audit_entries WHERE decision = 'require_approval'`).get() as { c: number }).c;
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
      byAgent: byAgent.map((r) => ({ agentType: r.agent_type, count: r.c })),
      byTool: byTool.map((r) => ({ tool: r.tool, count: r.c })),
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
