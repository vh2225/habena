import { describe, it, expect } from "vitest";
import { matches } from "../../src/policy/matcher.js";
import type { Rule } from "../../src/policy/types.js";

interface Call {
  tool: string;
  args: Record<string, unknown>;
  tool_tag?: string;
  registry?: string;
}

describe("matcher", () => {
  it("matches exact tool name", () => {
    const rule: Rule = { match: { tool: "gmail_send" }, action: "deny" };
    const call: Call = { tool: "gmail_send", args: {} };
    expect(matches(rule, call)).toBe(true);
  });

  it("does not match different tool name", () => {
    const rule: Rule = { match: { tool: "gmail_send" }, action: "deny" };
    const call: Call = { tool: "github_search", args: {} };
    expect(matches(rule, call)).toBe(false);
  });

  it("matches tool wildcard", () => {
    const rule: Rule = { match: { tool: "shell_*" }, action: "deny" };
    const call: Call = { tool: "shell_execute", args: {} };
    expect(matches(rule, call)).toBe(true);
  });

  it("matches wildcard alone", () => {
    const rule: Rule = { match: { tool: "*" }, action: "allow" };
    expect(matches(rule, { tool: "anything", args: {} })).toBe(true);
  });

  it("matches tool_tag", () => {
    const rule: Rule = { match: { tool_tag: "communication" }, action: "require_approval" };
    const call: Call = { tool: "gmail_send", args: {}, tool_tag: "communication" };
    expect(matches(rule, call)).toBe(true);
  });

  it("matches args_contain substring", () => {
    const rule: Rule = { match: { tool: "shell_*", args_contain: ["rm -rf"] }, action: "deny" };
    const call: Call = { tool: "shell_execute", args: { command: "rm -rf /tmp/cache" } };
    expect(matches(rule, call)).toBe(true);
  });

  it("does not match args_contain when absent", () => {
    const rule: Rule = { match: { tool: "shell_*", args_contain: ["rm -rf"] }, action: "deny" };
    const call: Call = { tool: "shell_execute", args: { command: "ls -la" } };
    expect(matches(rule, call)).toBe(false);
  });

  it("matches command_matches for shell", () => {
    const rule: Rule = { match: { command_matches: ["DROP TABLE", "DROP DATABASE"] }, action: "deny" };
    const call: Call = { tool: "shell_execute", args: { command: "psql -c 'DROP TABLE users;'" } };
    expect(matches(rule, call)).toBe(true);
  });

  it("matches registry", () => {
    const rule: Rule = { match: { registry: "official" }, action: "allow" };
    const call: Call = { tool: "github_search", args: {}, registry: "official" };
    expect(matches(rule, call)).toBe(true);
  });

  it("combined criteria: ALL must match (AND semantics)", () => {
    const rule: Rule = {
      match: { tool: "shell_*", args_contain: ["rm"] },
      action: "deny",
    };
    const tooBroad: Call = { tool: "filesystem_write", args: { command: "rm -rf" } };
    expect(matches(rule, tooBroad)).toBe(false);

    const noArgs: Call = { tool: "shell_execute", args: { command: "ls" } };
    expect(matches(rule, noArgs)).toBe(false);

    const both: Call = { tool: "shell_execute", args: { command: "rm -rf" } };
    expect(matches(rule, both)).toBe(true);
  });

  it("matches path_starts_with when args.path has the prefix", () => {
    const rule: Rule = {
      match: { tool: "filesystem_write", path_starts_with: ["/tmp", "~/workspace"] },
      action: "allow",
    };
    expect(
      matches(rule, { tool: "filesystem_write", args: { path: "/tmp/cache.json" } })
    ).toBe(true);
  });

  it("does not match path_starts_with when no prefix matches", () => {
    const rule: Rule = {
      match: { tool: "filesystem_write", path_starts_with: ["/tmp", "~/workspace"] },
      action: "allow",
    };
    expect(
      matches(rule, { tool: "filesystem_write", args: { path: "/etc/passwd" } })
    ).toBe(false);
  });
});
