import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { observe, propose } from "../../src/learn/analyzer.js";

// Helper: create a DB with the production schema + seed rows.
function makeDb(): { path: string; insert: (row: Row) => void; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "agentguard-learn-"));
  const path = join(dir, "audit.db");
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
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
    );
  `);
  const insert = (row: Row) =>
    db
      .prepare(
        `INSERT INTO audit_entries (timestamp, agent_type, instance_id, tool, args, mcp_server, decision, tier, result_status) VALUES (?, ?, ?, ?, '{}', 'm', ?, ?, 'success')`
      )
      .run(
        row.timestamp ?? new Date().toISOString(),
        row.agentType ?? "main",
        row.instanceId ?? "inst-1",
        row.tool,
        row.decision,
        row.tier ?? "user"
      );
  const cleanup = () => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { path, insert, cleanup };
}

interface Row {
  tool: string;
  decision: "allow" | "deny" | "require_approval";
  tier?: "built_in" | "user" | "session";
  agentType?: string;
  instanceId?: string;
  timestamp?: string;
}

describe("observe", () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => { db = makeDb(); });
  afterEach(() => { db.cleanup(); });

  it("returns an empty array when the table doesn't exist", () => {
    const empty = mkdtempSync(join(tmpdir(), "ag-empty-"));
    try {
      const dbPath = join(empty, "audit.db");
      const d = new Database(dbPath);
      d.close();
      expect(observe(dbPath)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("buckets by (agent_type, tool) and counts decisions", () => {
    for (let i = 0; i < 5; i++) db.insert({ tool: "read_file", decision: "allow" });
    db.insert({ tool: "read_file", decision: "deny" });
    db.insert({ tool: "write_file", decision: "require_approval" });
    const results = observe(db.path);
    expect(results).toHaveLength(2);
    const read = results.find((r) => r.tool === "read_file")!;
    expect(read.total).toBe(6);
    expect(read.allowed).toBe(5);
    expect(read.denied).toBe(1);
    const write = results.find((r) => r.tool === "write_file")!;
    expect(write.total).toBe(1);
    expect(write.requiredApproval).toBe(1);
  });

  it("filters by agent_type when provided", () => {
    db.insert({ tool: "read_file", decision: "allow", agentType: "a" });
    db.insert({ tool: "read_file", decision: "allow", agentType: "b" });
    const results = observe(db.path, { agentType: "a" });
    expect(results).toHaveLength(1);
    expect(results[0].agentType).toBe("a");
  });

  it("respects the sinceDays window", () => {
    const old = new Date(Date.now() - 30 * 86400000).toISOString();
    db.insert({ tool: "old_tool", decision: "allow", timestamp: old });
    db.insert({ tool: "new_tool", decision: "allow" });
    expect(observe(db.path, { sinceDays: 7 }).map((o) => o.tool)).toEqual(["new_tool"]);
    expect(observe(db.path, { sinceDays: 60 }).map((o) => o.tool).sort()).toEqual([
      "new_tool",
      "old_tool",
    ]);
  });
});

describe("propose", () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => { db = makeDb(); });
  afterEach(() => { db.cleanup(); });

  it("suggests allow for a tool consistently allowed over N calls", () => {
    for (let i = 0; i < 15; i++) db.insert({ tool: "read_file", decision: "allow" });
    const suggestions = propose(observe(db.path));
    const s = suggestions.find((x) => x.rule.match.tool === "read_file")!;
    expect(s.rule.action).toBe("allow");
  });

  it("suggests deny when denies dominate", () => {
    for (let i = 0; i < 4; i++) db.insert({ tool: "delete_all", decision: "deny" });
    const s = propose(observe(db.path)).find((x) => x.rule.match.tool === "delete_all")!;
    expect(s.rule.action).toBe("deny");
  });

  it("suggests require_approval for mixed outcomes", () => {
    for (let i = 0; i < 3; i++) db.insert({ tool: "send_mail", decision: "allow" });
    db.insert({ tool: "send_mail", decision: "deny" });
    const s = propose(observe(db.path)).find((x) => x.rule.match.tool === "send_mail")!;
    expect(s.rule.action).toBe("require_approval");
  });

  it("respects minObservationsForAllow — doesn't suggest allow on just 1 call", () => {
    db.insert({ tool: "rare_tool", decision: "allow" });
    const suggestions = propose(observe(db.path));
    expect(suggestions.find((x) => x.rule.match.tool === "rare_tool")).toBeUndefined();
  });

  it("never suggests weakening a built-in/hard-boundary match", () => {
    db.insert({ tool: "dangerous", decision: "deny", tier: "built_in" });
    const suggestions = propose(observe(db.path));
    expect(suggestions.find((x) => x.rule.match.tool === "dangerous")).toBeUndefined();
  });
});
