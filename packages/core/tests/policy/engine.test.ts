import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/policy/engine.js";
import type { Rule } from "../../src/policy/types.js";

describe("PolicyEngine", () => {
  it("hard boundary deny wins over user allow", () => {
    const userRules: Rule[] = [{ match: { tool: "*" }, action: "allow" }];
    const engine = new PolicyEngine(userRules);
    const decision = engine.evaluate({
      tool: "shell_execute",
      args: { command: "rm -rf /" },
    });
    expect(decision.action).toBe("deny");
    expect(decision.enforcement).toBe("hard_mandatory");
    expect(decision.tier).toBe("built_in");
  });

  it("user allow rule permits a normal tool call", () => {
    const userRules: Rule[] = [
      { match: { tool: "github_search" }, action: "allow" },
    ];
    const engine = new PolicyEngine(userRules);
    const decision = engine.evaluate({
      tool: "github_search",
      args: { query: "test" },
    });
    expect(decision.action).toBe("allow");
    expect(decision.tier).toBe("user");
  });

  it("user deny overrides default allow-all", () => {
    const userRules: Rule[] = [
      { match: { tool: "stripe_charge" }, action: "deny", reason: "No payments" },
      { match: { tool: "*" }, action: "allow" },
    ];
    const engine = new PolicyEngine(userRules);
    const decision = engine.evaluate({
      tool: "stripe_charge",
      args: { amount: 100 },
    });
    expect(decision.action).toBe("deny");
    expect(decision.reason).toBe("No payments");
  });

  it("session override takes precedence over user rule for same match", () => {
    const userRules: Rule[] = [
      { match: { tool: "gmail_send" }, action: "deny" },
    ];
    const engine = new PolicyEngine(userRules);
    engine.addSessionOverride(
      { match: { tool: "gmail_send" }, action: "allow" },
      new Date(Date.now() + 60_000)
    );
    const decision = engine.evaluate({
      tool: "gmail_send",
      args: { to: "test@example.com" },
    });
    expect(decision.action).toBe("allow");
    expect(decision.tier).toBe("session");
  });

  it("expired session override is ignored", () => {
    const userRules: Rule[] = [
      { match: { tool: "gmail_send" }, action: "deny" },
    ];
    const engine = new PolicyEngine(userRules);
    engine.addSessionOverride(
      { match: { tool: "gmail_send" }, action: "allow" },
      new Date(Date.now() - 1000)
    );
    const decision = engine.evaluate({
      tool: "gmail_send",
      args: { to: "test@example.com" },
    });
    expect(decision.action).toBe("deny");
  });

  it("default rule matches when no user rule does", () => {
    const engine = new PolicyEngine([]);
    const decision = engine.evaluate({
      tool: "gmail_send",
      args: { to: "x" },
      tool_tag: "communication",
    });
    expect(decision.action).toBe("require_approval");
  });

  it("implicit deny when nothing matches", () => {
    const engine = new PolicyEngine([]);
    const decision = engine.evaluate({
      tool: "unknown_tool",
      args: {},
    });
    expect(decision.action).toBe("deny");
    expect(decision.reason).toContain("No matching rule");
  });

  it("hard boundary beats session override", () => {
    const rules: Rule[] = [{ match: { tool: "*" }, action: "allow" }];
    const engine = new PolicyEngine(rules);
    engine.addSessionOverride(
      { match: { command_matches: ["rm -rf /"] }, action: "allow" },
      new Date(Date.now() + 60_000)
    );
    const decision = engine.evaluate({
      tool: "shell_execute",
      args: { command: "rm -rf /" },
    });
    expect(decision.tier).toBe("built_in");
    expect(decision.enforcement).toBe("hard_mandatory");
  });

  it("user rules use first-match-wins, not deny-overrides-allow", () => {
    // A user who puts allow BEFORE deny gets allow. A user who puts
    // deny BEFORE allow gets deny. Rule ORDER matters.
    const allowFirst = new PolicyEngine([
      { match: { tool: "stripe_charge" }, action: "allow" },
      { match: { tool: "stripe_charge" }, action: "deny" },
    ]);
    const denyFirst = new PolicyEngine([
      { match: { tool: "stripe_charge" }, action: "deny" },
      { match: { tool: "stripe_charge" }, action: "allow" },
    ]);
    const call = { tool: "stripe_charge", args: {} };
    expect(allowFirst.evaluate(call).action).toBe("allow");
    expect(denyFirst.evaluate(call).action).toBe("deny");
  });

  it("normalizes deny_unless and deny_if rules to plain deny", () => {
    const engine = new PolicyEngine([
      { match: { tool: "filesystem_write" }, action: "deny_unless" },
      { match: { tool: "http_post" }, action: "deny_if" },
    ]);
    expect(
      engine.evaluate({ tool: "filesystem_write", args: { path: "/etc" } }).action
    ).toBe("deny");
    expect(
      engine.evaluate({ tool: "http_post", args: { url: "https://evil.example" } }).action
    ).toBe("deny");
  });
});
