import { describe, it, expect } from "vitest";
import { fmtTime, fmtLatency, uniqueValues, matchesFilters, type DecisionRow } from "./dashboard";

const row = (over: Partial<DecisionRow>): DecisionRow => ({
  id: 1, timestamp: "2026-06-09T12:00:00.000Z", agentType: "openclaw", instanceId: "i1",
  tool: "fs.write", mcpServer: "filesystem", decision: "deny", tier: "user_rule",
  ruleMatched: "no-writes", reason: "writes blocked", latencyMs: 12, resultStatus: "blocked",
  ...over,
});

describe("dashboard helpers", () => {
  it("fmtLatency renders ms or a dash", () => {
    expect(fmtLatency(12)).toBe("12ms");
    expect(fmtLatency(null)).toBe("—");
  });

  it("fmtTime returns a non-empty string and never throws on bad input", () => {
    expect(fmtTime("2026-06-09T12:00:00.000Z").length).toBeGreaterThan(0);
    expect(fmtTime("not-a-date")).toBe("not-a-date");
  });

  it("uniqueValues returns sorted distinct values for a key", () => {
    const rows = [row({ agentType: "b" }), row({ agentType: "a" }), row({ agentType: "b" })];
    expect(uniqueValues(rows, "agentType")).toEqual(["a", "b"]);
  });

  it("matchesFilters treats empty filters as match-all", () => {
    expect(matchesFilters(row({}), { agentType: "", decision: "", mcpServer: "" })).toBe(true);
  });

  it("matchesFilters ANDs the active filters", () => {
    const r = row({ agentType: "openclaw", decision: "deny", mcpServer: "filesystem" });
    expect(matchesFilters(r, { agentType: "openclaw", decision: "deny", mcpServer: "" })).toBe(true);
    expect(matchesFilters(r, { agentType: "openclaw", decision: "allow", mcpServer: "" })).toBe(false);
  });
});
