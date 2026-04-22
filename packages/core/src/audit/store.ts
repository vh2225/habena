import Database from "better-sqlite3";
import { dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type { AuditEntry, AuditQueryFilters } from "./types.js";

/**
 * Cap serialized args at 64 KB. A downstream MCP server returning a
 * multi-MB payload (or a poisoned agent sending a huge string) would
 * otherwise balloon the audit DB. The marker field lets querying code
 * tell a truncated row from a legitimately large-but-intact one.
 */
const MAX_ARGS_BYTES = 64 * 1024;
function truncateArgs(args: Record<string, unknown>): string {
  const json = JSON.stringify(args);
  if (json.length <= MAX_ARGS_BYTES) return json;
  return JSON.stringify({
    __truncated__: true,
    __original_size_bytes__: json.length,
    __preview__: json.slice(0, 2048),
  });
}

export class AuditStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        args TEXT NOT NULL,
        mcp_server TEXT NOT NULL,
        decision TEXT NOT NULL,
        tier TEXT NOT NULL,
        rule_matched TEXT,
        reason TEXT,
        cost REAL,
        latency_ms INTEGER,
        result_status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_agent_type ON audit_entries(agent_type);
      CREATE INDEX IF NOT EXISTS idx_audit_instance_id ON audit_entries(instance_id);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_entries(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_decision ON audit_entries(decision);
    `);
  }

  insert(entry: AuditEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_entries (
        timestamp, agent_type, instance_id, tool, args, mcp_server,
        decision, tier, rule_matched, reason, cost, latency_ms, result_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.timestamp.toISOString(),
      entry.agentType,
      entry.instanceId,
      entry.tool,
      truncateArgs(entry.args),
      entry.mcpServer,
      entry.decision,
      entry.tier,
      entry.ruleMatched ?? null,
      entry.reason ?? null,
      entry.cost,
      entry.latencyMs,
      entry.resultStatus
    );
  }

  query(filters: AuditQueryFilters): AuditEntry[] {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.agentType) {
      where.push("agent_type = ?");
      params.push(filters.agentType);
    }
    if (filters.instanceId) {
      where.push("instance_id = ?");
      params.push(filters.instanceId);
    }
    if (filters.since) {
      where.push("timestamp >= ?");
      params.push(filters.since.toISOString());
    }
    if (filters.decision) {
      where.push("decision = ?");
      params.push(filters.decision);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const limit = filters.limit ?? 1000;
    const sql = `SELECT * FROM audit_entries ${whereClause} ORDER BY timestamp DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, limit) as Record<string, unknown>[];

    return rows.map(this.rowToEntry);
  }

  prune(retentionDays: number): number {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = this.db
      .prepare("DELETE FROM audit_entries WHERE timestamp < ?")
      .run(cutoff.toISOString());
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  private rowToEntry(row: Record<string, unknown>): AuditEntry {
    return {
      timestamp: new Date(row.timestamp as string),
      agentType: row.agent_type as string,
      instanceId: row.instance_id as string,
      tool: row.tool as string,
      args: JSON.parse(row.args as string),
      mcpServer: row.mcp_server as string,
      decision: row.decision as AuditEntry["decision"],
      tier: row.tier as AuditEntry["tier"],
      ruleMatched: (row.rule_matched as string | null) ?? undefined,
      reason: (row.reason as string | null) ?? undefined,
      cost: row.cost as number | null,
      latencyMs: row.latency_ms as number | null,
      resultStatus: row.result_status as AuditEntry["resultStatus"],
    };
  }
}
