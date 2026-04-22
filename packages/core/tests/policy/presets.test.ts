import { describe, it, expect } from "vitest";
import { PRESETS, listPresets, getPreset, applyPreset } from "../../src/policy/presets.js";
import { PolicyEngine } from "../../src/policy/engine.js";
import type { AgentGuardConfig } from "../../src/policy/types.js";

describe("policy presets", () => {
  it("listPresets returns all known presets", () => {
    const names = listPresets().map((p) => p.name);
    expect(names).toContain("observe");
    expect(names).toContain("cautious");
    expect(names).toContain("deny-all");
  });

  it("getPreset returns undefined for unknown names", () => {
    expect(getPreset("does-not-exist")).toBeUndefined();
  });

  it("applyPreset replaces rules but preserves other config", () => {
    const existing: AgentGuardConfig = {
      budget: { daily: 50 },
      rules: [{ match: { tool: "*" }, action: "deny" }],
      mcp_servers: { fs: { command: "npx", args: ["-y", "fs-server"] } },
    };
    const after = applyPreset(existing, PRESETS.cautious);
    expect(after.rules).toEqual(PRESETS.cautious.rules);
    expect(after.budget).toEqual({ daily: 50 });
    expect(after.mcp_servers).toEqual(existing.mcp_servers);
  });
});

describe("preset semantic checks — engine actually applies the rules correctly", () => {
  it("observe: allows read + write + delete (everything)", () => {
    const engine = new PolicyEngine(PRESETS.observe.rules);
    expect(engine.evaluate({ tool: "read_file", args: { path: "/a" } }).action).toBe("allow");
    expect(engine.evaluate({ tool: "write_file", args: { path: "/a" } }).action).toBe("allow");
    expect(engine.evaluate({ tool: "delete_all", args: {} }).action).toBe("allow");
  });

  it("observe: hard-denies destructive shell commands regardless", () => {
    const engine = new PolicyEngine(PRESETS.observe.rules);
    const r = engine.evaluate({ tool: "shell_exec", args: { command: "rm -rf /" } });
    expect(r.action).toBe("deny");
    expect(r.enforcement).toBe("hard_mandatory");
  });

  it("cautious: read_ allowed, write_ approval, delete_ denied", () => {
    const engine = new PolicyEngine(PRESETS.cautious.rules);
    expect(engine.evaluate({ tool: "read_file", args: {} }).action).toBe("allow");
    expect(engine.evaluate({ tool: "write_file", args: {} }).action).toBe("require_approval");
    const del = engine.evaluate({ tool: "delete_user", args: {} });
    expect(del.action).toBe("deny");
    expect(del.enforcement).toBe("hard_mandatory");
  });

  it("cautious: unknown tools fall through to require_approval", () => {
    const engine = new PolicyEngine(PRESETS.cautious.rules);
    expect(engine.evaluate({ tool: "weird_new_tool", args: {} }).action).toBe("require_approval");
  });

  it("deny-all: literally everything hard-denied", () => {
    const engine = new PolicyEngine(PRESETS["deny-all"].rules);
    const r = engine.evaluate({ tool: "read_file", args: {} });
    expect(r.action).toBe("deny");
    expect(r.enforcement).toBe("hard_mandatory");
  });
});
