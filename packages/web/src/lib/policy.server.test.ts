import { describe, it, expect } from "vitest";
import { parsePolicy } from "./policy.server";

describe("parsePolicy", () => {
  it("returns not-configured for null/malformed yaml (never throws)", () => {
    expect(parsePolicy(null).configured).toBe(false);
    expect(parsePolicy(":::bad").configured).toBe(false);
  });

  it("extracts budget, ordered rules, extends, approval (names only), downstreams", () => {
    const text = [
      "budget:",
      "  daily: 50",
      "  on_exceed: deny",
      "rules:",
      "  - match: { tool: read_file }",
      "    action: allow",
      "    reason: pack:fs",
      "  - match: { tool: write_file }",
      "    action: require_approval",
      "    enforcement: hard_mandatory",
      "extends: [filesystem-readonly]",
      "approval:",
      "  timeout_action: deny",
      "  require_for: { tools: [shell_execute], tool_tags: [destructive] }",
      "  channels:",
      "    telegram:",
      "      token: SUPERSECRET",
      "      owner_id: 1",
      "mcp_servers:",
      "  filesystem:",
      "    command: npx",
    ].join("\n");
    const p = parsePolicy(text);
    expect(p.configured).toBe(true);
    expect(p.budget).toMatchObject({ daily: 50, onExceed: "deny" });
    expect(p.rules.map((r) => r.action)).toEqual(["allow", "require_approval"]);
    expect(p.rules[0].index).toBe(0);
    expect(p.rules[1].enforcement).toBe("hard_mandatory");
    expect(p.extendsPacks).toEqual(["filesystem-readonly"]);
    expect(p.approval).toMatchObject({ timeoutAction: "deny" });
    expect(p.approval?.alwaysRequire).toEqual(["shell_execute", "destructive"]);
    expect(p.approval?.channels).toEqual(["telegram"]);
    expect(p.downstreams).toEqual([{ name: "filesystem", command: "npx" }]);
    // SECRET HYGIENE: the token must never appear anywhere in the view
    expect(JSON.stringify(p)).not.toContain("SUPERSECRET");
  });

  it("handles a partial config (missing sections) without throwing", () => {
    const p = parsePolicy("budget: {}\n");
    expect(p.configured).toBe(true);
    expect(p.rules).toEqual([]);
    expect(p.approval).toBeNull();
    expect(p.downstreams).toEqual([]);
  });
});
