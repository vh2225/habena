import { describe, it, expect } from "vitest";
import { expandHome, getConfigPath, getAgentsPath, getAuditDbPath } from "../../src/config/paths.js";
import { homedir } from "node:os";
import { join } from "node:path";

describe("paths", () => {
  it("expands ~ to home directory", () => {
    expect(expandHome("~/foo")).toBe(join(homedir(), "foo"));
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandHome("/tmp/bar")).toBe("/tmp/bar");
  });

  it("returns config.yaml under ~/.agentguard", () => {
    expect(getConfigPath()).toBe(join(homedir(), ".agentguard", "config.yaml"));
  });

  it("returns agents.yaml under ~/.agentguard", () => {
    expect(getAgentsPath()).toBe(join(homedir(), ".agentguard", "agents.yaml"));
  });

  it("returns audit.db under ~/.agentguard", () => {
    expect(getAuditDbPath()).toBe(join(homedir(), ".agentguard", "audit.db"));
  });
});
