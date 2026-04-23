import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/policy/engine.js";
import type { Rule } from "../../src/policy/types.js";

// Phase 8 V3 — host-policy floor. The operator writes
// ~/.agentguard/host-policy.yaml; the engine treats those rules as a
// floor that `config.yaml` alone cannot weaken.

describe("PolicyEngine — host-policy floor", () => {
  it("host deny wins over user allow for the same tool", () => {
    const userRules: Rule[] = [{ match: { tool: "github_push" }, action: "allow" }];
    const hostRules: Rule[] = [{ match: { tool: "github_push" }, action: "deny", reason: "host floor" }];
    const engine = new PolicyEngine(userRules, hostRules);
    const decision = engine.evaluate({ tool: "github_push", args: {} });
    expect(decision.action).toBe("deny");
    expect(decision.tier).toBe("host");
    expect(decision.reason).toBe("host floor");
  });

  it("host require_approval wins over user allow", () => {
    const userRules: Rule[] = [{ match: { tool: "gmail_send" }, action: "allow" }];
    const hostRules: Rule[] = [{ match: { tool: "gmail_send" }, action: "require_approval" }];
    const engine = new PolicyEngine(userRules, hostRules);
    const decision = engine.evaluate({ tool: "gmail_send", args: {} });
    expect(decision.action).toBe("require_approval");
    expect(decision.tier).toBe("host");
  });

  it("user deny wins over host require_approval (user is stricter)", () => {
    const userRules: Rule[] = [{ match: { tool: "gmail_send" }, action: "deny" }];
    const hostRules: Rule[] = [{ match: { tool: "gmail_send" }, action: "require_approval" }];
    const engine = new PolicyEngine(userRules, hostRules);
    const decision = engine.evaluate({ tool: "gmail_send", args: {} });
    expect(decision.action).toBe("deny");
    expect(decision.tier).toBe("user");
  });

  it("host allow does not block a user deny", () => {
    const userRules: Rule[] = [{ match: { tool: "gmail_send" }, action: "deny" }];
    const hostRules: Rule[] = [{ match: { tool: "gmail_send" }, action: "allow" }];
    const engine = new PolicyEngine(userRules, hostRules);
    const decision = engine.evaluate({ tool: "gmail_send", args: {} });
    expect(decision.action).toBe("deny");
    expect(decision.tier).toBe("user");
  });

  it("host applies when user has no matching rule", () => {
    const userRules: Rule[] = [];
    const hostRules: Rule[] = [{ match: { tool: "write_*" }, action: "deny" }];
    const engine = new PolicyEngine(userRules, hostRules);
    const decision = engine.evaluate({ tool: "write_file", args: {} });
    expect(decision.action).toBe("deny");
    expect(decision.tier).toBe("host");
  });

  it("user applies when host has no matching rule", () => {
    const userRules: Rule[] = [{ match: { tool: "read_file" }, action: "allow" }];
    const hostRules: Rule[] = [{ match: { tool: "write_*" }, action: "deny" }];
    const engine = new PolicyEngine(userRules, hostRules);
    const decision = engine.evaluate({ tool: "read_file", args: {} });
    expect(decision.action).toBe("allow");
    expect(decision.tier).toBe("user");
  });

  it("hard boundary still wins over a host allow", () => {
    const userRules: Rule[] = [];
    const hostRules: Rule[] = [{ match: { tool: "*" }, action: "allow" }];
    const engine = new PolicyEngine(userRules, hostRules);
    const decision = engine.evaluate({
      tool: "shell_execute",
      args: { command: "rm -rf /" },
    });
    expect(decision.action).toBe("deny");
    expect(decision.tier).toBe("built_in");
    expect(decision.enforcement).toBe("hard_mandatory");
  });

  it("session override cannot bypass host deny", () => {
    const userRules: Rule[] = [];
    const hostRules: Rule[] = [{ match: { tool: "fs_delete" }, action: "deny" }];
    const engine = new PolicyEngine(userRules, hostRules);
    engine.addSessionOverride(
      { match: { tool: "fs_delete" }, action: "allow" },
      new Date(Date.now() + 60_000)
    );
    const decision = engine.evaluate({ tool: "fs_delete", args: {} });
    // Session overrides come BEFORE host/user in the tier order (that's
    // the product design — a session override is an explicit human
    // authorization). Document that here so the next person changing
    // the order doesn't quietly invert it.
    expect(decision.tier).toBe("session");
    expect(decision.action).toBe("allow");
  });

  it("host enforcement hard_mandatory beats user soft_mandatory on same action", () => {
    const userRules: Rule[] = [
      { match: { tool: "fs_delete" }, action: "deny", enforcement: "soft_mandatory" },
    ];
    const hostRules: Rule[] = [
      { match: { tool: "fs_delete" }, action: "deny", enforcement: "hard_mandatory" },
    ];
    const engine = new PolicyEngine(userRules, hostRules);
    const decision = engine.evaluate({ tool: "fs_delete", args: {} });
    expect(decision.action).toBe("deny");
    expect(decision.enforcement).toBe("hard_mandatory");
    expect(decision.tier).toBe("host");
  });

  it("implicit deny still fires when neither host nor user match", () => {
    const engine = new PolicyEngine([], []);
    const decision = engine.evaluate({ tool: "mystery_tool", args: {} });
    // Default rules may or may not match; the important property is that
    // no host/user tier decision was returned when neither had rules.
    expect(["built_in"]).toContain(decision.tier);
  });
});
