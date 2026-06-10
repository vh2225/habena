import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spendSummary } from "./audit";

const SCHEMA = `
CREATE TABLE audit_entries (
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
);`;

let dir: string;

function seed(rows: Array<{ ts: Date; agent?: string; tool?: string; decision?: string; cost?: number | null }>) {
  const dbPath = join(dir, "audit.db");
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  const ins = db.prepare(
    `INSERT INTO audit_entries (timestamp, agent_type, instance_id, tool, args, mcp_server, decision, tier, rule_matched, reason, cost, latency_ms, result_status)
     VALUES (?, ?, 'i1', ?, '{}', 'srv', ?, 'user', NULL, NULL, ?, 1, 'success')`
  );
  for (const r of rows) {
    ins.run(r.ts.toISOString(), r.agent ?? "openclaw", r.tool ?? "web_search", r.decision ?? "allow", r.cost ?? 0);
  }
  db.close();
  process.env.HABENA_AUDIT_DB = dbPath;
}

describe("spendSummary", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "spend-"));
  });
  afterEach(() => {
    delete process.env.HABENA_AUDIT_DB;
    rmSync(dir, { recursive: true, force: true });
  });

  it("counts allowed calls and declared cost for today, ignoring denies", () => {
    const now = new Date();
    seed([
      { ts: now, cost: 0.01 },
      { ts: now, cost: 0 },
      { ts: now, decision: "deny", cost: null },
    ]);
    const s = spendSummary();
    expect(s.callsToday).toBe(2);
    expect(s.costToday).toBeCloseTo(0.01);
  });

  it("excludes yesterday from today's numbers but keeps it out of last-hour too", () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 26 * 3_600_000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 3_600_000);
    seed([
      { ts: yesterday, cost: 5 },
      { ts: twoHoursAgo, cost: 0.02 },
      { ts: now, cost: 0.01 },
    ]);
    const s = spendSummary();
    expect(s.callsLastHour).toBe(1);
    // twoHoursAgo may or may not be "today" depending on wall clock — but
    // yesterday's $5 must never leak in.
    expect(s.costToday).toBeLessThan(1);
  });

  it("breaks down by agent and tool for today", () => {
    const now = new Date();
    seed([
      { ts: now, agent: "openclaw", tool: "web_search", cost: 0.01 },
      { ts: now, agent: "openclaw", tool: "read_file", cost: 0 },
      { ts: now, agent: "research-bot", tool: "web_search", cost: 0.01 },
    ]);
    const s = spendSummary();
    const oc = s.byAgent.find((a) => a.agentType === "openclaw");
    expect(oc?.calls).toBe(2);
    expect(oc?.cost).toBeCloseTo(0.01);
    const ws = s.byTool.find((t) => t.tool === "web_search");
    expect(ws?.calls).toBe(2);
    expect(ws?.cost).toBeCloseTo(0.02);
  });

  it("returns hourly buckets covering the last 24h", () => {
    const now = new Date();
    seed([{ ts: now, cost: 0.01 }]);
    const s = spendSummary();
    expect(s.hourly).toHaveLength(24);
    const total = s.hourly.reduce((sum, h) => sum + h.calls, 0);
    expect(total).toBe(1);
    expect(s.hourly[23].calls).toBe(1); // newest bucket is last
  });

  it("sums result_meter tokens for today and tolerates the table being absent", () => {
    const now = new Date();
    seed([{ ts: now, cost: 0 }]);
    // Old DBs (pre-0.4 proxies) have no result_meter table.
    expect(spendSummary().resultTokensToday).toBe(0);

    const db = new Database(join(dir, "audit.db"));
    db.exec(`CREATE TABLE result_meter (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, agent_type TEXT NOT NULL, instance_id TEXT NOT NULL, tokens INTEGER NOT NULL)`);
    db.prepare(`INSERT INTO result_meter (timestamp, agent_type, instance_id, tokens) VALUES (?, 'openclaw', 'i1', 1200)`).run(now.toISOString());
    db.prepare(`INSERT INTO result_meter (timestamp, agent_type, instance_id, tokens) VALUES (?, 'openclaw', 'i1', 999)`).run(new Date(now.getTime() - 26 * 3_600_000).toISOString());
    db.close();
    expect(spendSummary().resultTokensToday).toBe(1200);
  });

  it("returns zeros when the db is missing", () => {
    process.env.HABENA_AUDIT_DB = join(dir, "nope.db");
    const s = spendSummary();
    expect(s.callsToday).toBe(0);
    expect(s.hourly).toHaveLength(24);
  });
});
