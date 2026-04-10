import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditStore } from "../../src/audit/store.js";
import type { AuditEntry } from "../../src/audit/types.js";

function sampleEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date(),
    agentType: "openclaw",
    instanceId: "openclaw/session-a",
    tool: "github_search",
    args: { query: "test" },
    mcpServer: "github-mcp",
    decision: "allow",
    tier: "user",
    ruleMatched: "user:allow-github",
    reason: "github allowed",
    cost: 0.01,
    latencyMs: 42,
    resultStatus: "success",
    ...overrides,
  };
}

describe("AuditStore", () => {
  let dir: string;
  let dbPath: string;
  let store: AuditStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-"));
    dbPath = join(dir, "audit.db");
    store = new AuditStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the database file", () => {
    store.insert(sampleEntry());
    expect(store.query({}).length).toBe(1);
  });

  it("inserts and retrieves an entry", () => {
    const entry = sampleEntry({ tool: "custom_tool" });
    store.insert(entry);
    const results = store.query({});
    expect(results[0].tool).toBe("custom_tool");
    expect(results[0].args).toEqual({ query: "test" });
  });

  it("filters by agent type", () => {
    store.insert(sampleEntry({ agentType: "openclaw" }));
    store.insert(sampleEntry({ agentType: "research-bot" }));
    const results = store.query({ agentType: "openclaw" });
    expect(results).toHaveLength(1);
    expect(results[0].agentType).toBe("openclaw");
  });

  it("filters by instance id", () => {
    store.insert(sampleEntry({ instanceId: "a" }));
    store.insert(sampleEntry({ instanceId: "b" }));
    expect(store.query({ instanceId: "a" })).toHaveLength(1);
  });

  it("filters by decision", () => {
    store.insert(sampleEntry({ decision: "allow" }));
    store.insert(sampleEntry({ decision: "deny" }));
    expect(store.query({ decision: "deny" })).toHaveLength(1);
  });

  it("filters by timestamp", () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const recent = new Date();
    store.insert(sampleEntry({ timestamp: old }));
    store.insert(sampleEntry({ timestamp: recent }));
    const results = store.query({ since: new Date(Date.now() - 60_000) });
    expect(results).toHaveLength(1);
  });

  it("respects limit", () => {
    for (let i = 0; i < 10; i++) {
      store.insert(sampleEntry());
    }
    expect(store.query({ limit: 3 })).toHaveLength(3);
  });

  it("orders results newest-first", () => {
    store.insert(sampleEntry({
      timestamp: new Date("2026-04-01"),
      ruleMatched: "first",
    }));
    store.insert(sampleEntry({
      timestamp: new Date("2026-04-02"),
      ruleMatched: "second",
    }));
    const results = store.query({});
    expect(results[0].ruleMatched).toBe("second");
  });

  it("prunes entries older than retention", () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    store.insert(sampleEntry({ timestamp: old }));
    store.insert(sampleEntry({ timestamp: new Date() }));
    const deleted = store.prune(30);
    expect(deleted).toBe(1);
    expect(store.query({}).length).toBe(1);
  });
});
