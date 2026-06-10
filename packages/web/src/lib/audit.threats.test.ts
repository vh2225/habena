import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { threatSummary } from "./audit";

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

function seed(rows: Array<{ ts?: Date; tool?: string; server?: string; decision?: string; reason: string | null }>) {
  const dbPath = join(dir, "audit.db");
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  const ins = db.prepare(
    `INSERT INTO audit_entries (timestamp, agent_type, instance_id, tool, args, mcp_server, decision, tier, rule_matched, reason, cost, latency_ms, result_status)
     VALUES (?, 'openclaw', 'i1', ?, '{}', ?, ?, 'built_in', NULL, ?, 0, 1, 'error')`
  );
  for (const r of rows) {
    ins.run((r.ts ?? new Date()).toISOString(), r.tool ?? "read_file", r.server ?? "fs", r.decision ?? "deny", r.reason);
  }
  db.close();
  process.env.HABENA_AUDIT_DB = dbPath;
}

describe("threatSummary", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "threats-"));
  });
  afterEach(() => {
    delete process.env.HABENA_AUDIT_DB;
    rmSync(dir, { recursive: true, force: true });
  });

  it("groups events by server/tool/detector with counts and outcomes", () => {
    seed([
      { reason: "threat:credential_egress: secret in args", decision: "deny" },
      { reason: "threat:credential_egress: secret in args", decision: "deny" },
      { reason: "approved: threat:credential_egress: secret in args", decision: "allow" },
      { tool: "help", server: "evil", reason: "threat:tool_poisoning: injection cue", decision: "require_approval" },
      { reason: "plain policy deny", decision: "deny" }, // not a threat
    ]);
    const s = threatSummary();
    expect(s.totalEvents).toBe(4);
    const egress = s.groups.find((g) => g.detector === "credential_egress");
    expect(egress?.count).toBe(3);
    expect(egress?.denied).toBe(2);
    expect(egress?.allowed).toBe(1); // the human-approved one
    expect(egress?.tool).toBe("read_file");
    const poison = s.groups.find((g) => g.detector === "tool_poisoning");
    expect(poison?.mcpServer).toBe("evil");
  });

  it("counts by detector and tracks first/last seen", () => {
    const early = new Date(Date.now() - 3 * 24 * 3_600_000);
    seed([
      { ts: early, reason: "threat:rug_pull: definition changed" },
      { reason: "threat:rug_pull: definition changed" },
    ]);
    const s = threatSummary();
    expect(s.byDetector).toEqual([{ detector: "rug_pull", count: 2 }]);
    const g = s.groups[0];
    expect(new Date(g.firstSeen).getTime()).toBeLessThan(new Date(g.lastSeen).getTime());
  });

  it("returns an empty summary when the db is missing", () => {
    process.env.HABENA_AUDIT_DB = join(dir, "nope.db");
    const s = threatSummary();
    expect(s.totalEvents).toBe(0);
    expect(s.groups).toEqual([]);
  });
});
