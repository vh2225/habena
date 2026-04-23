import { describe, it, expect } from "vitest";
import { auditPolicy } from "../../src/policy/audit.js";
import type { Rule } from "../../src/policy/types.js";

describe("auditPolicy — wildcard-before-specific", () => {
  it("flags a specific deny hidden behind a wildcard allow", () => {
    const rules: Rule[] = [
      { match: { tool: "*" }, action: "allow" },
      { match: { tool: "fs_delete" }, action: "deny" },
    ];
    const findings = auditPolicy({ config: { rules } });
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe("wildcard-before-specific");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].userRuleIndex).toBe(1);
  });

  it("does not flag when the specific rule comes first", () => {
    const rules: Rule[] = [
      { match: { tool: "fs_delete" }, action: "deny" },
      { match: { tool: "*" }, action: "allow" },
    ];
    expect(auditPolicy({ config: { rules } })).toHaveLength(0);
  });

  it("does not flag wildcard-only rule sets", () => {
    const rules: Rule[] = [{ match: { tool: "*" }, action: "allow" }];
    expect(auditPolicy({ config: { rules } })).toHaveLength(0);
  });

  it("flags a require_approval hidden by a prior wildcard allow", () => {
    const rules: Rule[] = [
      { match: { tool: "*" }, action: "allow" },
      { match: { tool: "gmail_send" }, action: "require_approval" },
    ];
    const findings = auditPolicy({ config: { rules } });
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe("wildcard-before-specific");
  });
});

describe("auditPolicy — orphan-server-reference", () => {
  it("flags a rule referencing a server that isn't in mcp_servers", () => {
    const findings = auditPolicy({
      config: {
        mcp_servers: {
          filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
        },
        rules: [
          // Cast — the Rule `match` type doesn't formally declare `server`,
          // but the matcher/explain paths accept it. Rule packs in the
          // repo use it freely.
          { match: { server: "slakc", tool: "*" } as Rule["match"], action: "allow" },
        ],
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe("orphan-server-reference");
    expect(findings[0].message).toContain("slakc");
  });

  it("does not flag a rule referencing a configured server", () => {
    const findings = auditPolicy({
      config: {
        mcp_servers: { filesystem: { command: "npx", args: [] } },
        rules: [{ match: { server: "filesystem", tool: "*" } as Rule["match"], action: "allow" }],
      },
    });
    expect(findings).toHaveLength(0);
  });
});

describe("auditPolicy — host-policy-overridden-attempt", () => {
  it("flags a user allow that conflicts with a host deny on the same tool", () => {
    const userRules: Rule[] = [{ match: { tool: "gmail_send" }, action: "allow" }];
    const hostRules: Rule[] = [{ match: { tool: "gmail_send" }, action: "deny" }];
    const findings = auditPolicy({ config: { rules: userRules }, hostRules });
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe("host-policy-overridden-attempt");
    expect(findings[0].severity).toBe("info");
  });

  it("does not flag when the user rule is stricter", () => {
    const userRules: Rule[] = [{ match: { tool: "gmail_send" }, action: "deny" }];
    const hostRules: Rule[] = [{ match: { tool: "gmail_send" }, action: "require_approval" }];
    const findings = auditPolicy({ config: { rules: userRules }, hostRules });
    expect(findings.filter((f) => f.check === "host-policy-overridden-attempt")).toHaveLength(0);
  });

  it("does nothing when there's no host policy", () => {
    const userRules: Rule[] = [{ match: { tool: "gmail_send" }, action: "allow" }];
    const findings = auditPolicy({ config: { rules: userRules } });
    expect(findings).toHaveLength(0);
  });
});

describe("auditPolicy — clean policy", () => {
  it("returns no findings for a well-formed config", () => {
    const rules: Rule[] = [
      { match: { tool: "read_*" }, action: "allow" },
      { match: { tool: "write_*" }, action: "require_approval" },
      { match: { tool: "delete_*" }, action: "deny" },
    ];
    expect(auditPolicy({ config: { rules } })).toHaveLength(0);
  });
});
