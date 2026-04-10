import { describe, it, expect } from "vitest";
import { HARD_BOUNDARIES, DEFAULTS } from "../../src/policy/built-in-rules.js";
import { matches } from "../../src/policy/matcher.js";

describe("built-in rules", () => {
  it("HARD_BOUNDARIES includes rm -rf /", () => {
    const call = { tool: "shell_execute", args: { command: "rm -rf /" } };
    const matched = HARD_BOUNDARIES.some((r) => matches(r, call));
    expect(matched).toBe(true);
  });

  it("HARD_BOUNDARIES includes DROP DATABASE", () => {
    const call = { tool: "shell_execute", args: { command: "psql -c 'DROP DATABASE prod'" } };
    const matched = HARD_BOUNDARIES.some((r) => matches(r, call));
    expect(matched).toBe(true);
  });

  it("HARD_BOUNDARIES all use hard_mandatory enforcement", () => {
    for (const rule of HARD_BOUNDARIES) {
      expect(rule.enforcement).toBe("hard_mandatory");
    }
  });

  it("HARD_BOUNDARIES all have deny action", () => {
    for (const rule of HARD_BOUNDARIES) {
      expect(rule.action).toBe("deny");
    }
  });

  it("DEFAULTS includes a communication rule", () => {
    const hasCommRule = DEFAULTS.some((r) => r.match.tool_tag === "communication");
    expect(hasCommRule).toBe(true);
  });

  it("DEFAULTS rules are not hard_mandatory", () => {
    for (const rule of DEFAULTS) {
      expect(rule.enforcement).not.toBe("hard_mandatory");
    }
  });

  it("DEFAULTS does not match a normal github_search call", () => {
    const call = { tool: "github_search", args: { query: "AI safety" } };
    const matched = DEFAULTS.some((r) => matches(r, call));
    expect(matched).toBe(false);
  });
});
