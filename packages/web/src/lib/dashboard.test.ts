import { describe, it, expect } from "vitest";
import { fmtTime, fmtLatency, uniqueValues, matchesFilters, isThreat, type DecisionRow } from "./dashboard";

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

  it("fmtTime is time-only for today but includes the date for other days", () => {
    // Local-date constructors keep the test timezone-independent.
    const now = new Date(2026, 5, 9, 12, 0, 0);
    const today = fmtTime(new Date(2026, 5, 9, 8, 0, 0).toISOString(), now);
    const yesterday = fmtTime(new Date(2026, 5, 8, 8, 0, 0).toISOString(), now);
    // Local-time rendering, so just assert the shape: same-day stays short,
    // cross-day is prefixed with a date and therefore longer.
    expect(yesterday.length).toBeGreaterThan(today.length);
    expect(yesterday).toMatch(/[A-Za-z]/); // month name present
  });

  it("isThreat flags rows whose reason came from the threat engine", () => {
    expect(isThreat(row({ reason: "threat:credential-egress: AWS key in args" }))).toBe(true);
    expect(isThreat(row({ reason: "approved: threat:tool_poisoning: injection cue" }))).toBe(true);
    expect(isThreat(row({ reason: "writes blocked" }))).toBe(false);
    expect(isThreat(row({ reason: null }))).toBe(false);
  });

  it("uniqueValues returns sorted distinct values for a key", () => {
    const rows = [row({ agentType: "b" }), row({ agentType: "a" }), row({ agentType: "b" })];
    expect(uniqueValues(rows, "agentType")).toEqual(["a", "b"]);
  });

  it("matchesFilters treats empty filters as match-all", () => {
    expect(matchesFilters(row({}), { agentType: "", decision: "", mcpServer: "", threatsOnly: false })).toBe(true);
  });

  it("matchesFilters ANDs the active filters", () => {
    const r = row({ agentType: "openclaw", decision: "deny", mcpServer: "filesystem" });
    expect(matchesFilters(r, { agentType: "openclaw", decision: "deny", mcpServer: "", threatsOnly: false })).toBe(true);
    expect(matchesFilters(r, { agentType: "openclaw", decision: "allow", mcpServer: "", threatsOnly: false })).toBe(false);
  });

  it("matchesFilters threatsOnly keeps only threat-engine rows", () => {
    const all = { agentType: "", decision: "", mcpServer: "", threatsOnly: true };
    expect(matchesFilters(row({ reason: "threat:tool-poisoning: injection cue" }), all)).toBe(true);
    expect(matchesFilters(row({ reason: "writes blocked" }), all)).toBe(false);
  });
});
