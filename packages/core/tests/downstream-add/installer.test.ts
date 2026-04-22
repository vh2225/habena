import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import {
  addDownstreamServer,
  removeDownstreamServer,
  listDownstreamServers,
} from "../../src/downstream-add/installer.js";

// These tests need to redirect getConfigPath() → a tmp dir.
// getConfigPath reads $HOME, so stub os.homedir()'s return via a HOME env.

let tmp: string;
const origHome = process.env.HOME;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "agentguard-installer-"));
  process.env.HOME = tmp;
  // Force the `os` module's homedir cache to pick up the new HOME.
  // Vitest runs each file in isolation; we'll just ensure the paths module
  // re-reads homedir on each call, which it does (see src/config/paths.ts).
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(tmp, { recursive: true, force: true });
});

describe("addDownstreamServer", () => {
  it("creates config.yaml with the new server when config doesn't exist", () => {
    const result = addDownstreamServer(
      "fs",
      { command: "npx", args: ["-y", "server-fs", "/tmp"] }
    );
    expect(result.wrote).toBe(true);
    expect(existsSync(result.configPath)).toBe(true);
    const parsed = parseYaml(readFileSync(result.configPath, "utf8"));
    expect(parsed.mcp_servers.fs.command).toBe("npx");
  });

  it("preserves existing config sections (budget, rules) when adding", () => {
    const initial = "budget:\n  daily: 50\nrules:\n  - match: {tool: '*'}\n    action: allow\n";
    const configPath = join(tmp, ".agentguard", "config.yaml");
    const { mkdirSync } = require("node:fs");
    mkdirSync(join(tmp, ".agentguard"), { recursive: true });
    writeFileSync(configPath, initial);

    addDownstreamServer("gmail", { command: "node", args: ["server.mjs"] });
    const parsed = parseYaml(readFileSync(configPath, "utf8"));
    expect(parsed.budget.daily).toBe(50);
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.mcp_servers.gmail.command).toBe("node");
  });

  it("refuses to overwrite an existing name without --force", () => {
    addDownstreamServer("fs", { command: "a" });
    expect(() =>
      addDownstreamServer("fs", { command: "b" })
    ).toThrow(/already exists/);
  });

  it("replaces an existing server with --force", () => {
    addDownstreamServer("fs", { command: "old" });
    addDownstreamServer("fs", { command: "new" }, { force: true });
    const servers = listDownstreamServers();
    expect(servers.fs.command).toBe("new");
  });

  it("dry-run doesn't write the config", () => {
    const result = addDownstreamServer("fs", { command: "x" }, { dryRun: true });
    expect(result.wrote).toBe(false);
    expect(existsSync(result.configPath)).toBe(false);
  });

  it("backs up the existing config before overwriting", () => {
    addDownstreamServer("fs", { command: "a" });
    const result = addDownstreamServer("other", { command: "b" });
    expect(result.backupPath).toBeDefined();
    expect(existsSync(result.backupPath!)).toBe(true);
  });
});

describe("removeDownstreamServer", () => {
  it("returns false for unknown names", () => {
    addDownstreamServer("fs", { command: "x" });
    expect(removeDownstreamServer("nonexistent")).toBe(false);
  });

  it("removes and preserves other servers", () => {
    addDownstreamServer("fs", { command: "a" });
    addDownstreamServer("gmail", { command: "b" });
    expect(removeDownstreamServer("fs")).toBe(true);
    const servers = listDownstreamServers();
    expect(servers.fs).toBeUndefined();
    expect(servers.gmail.command).toBe("b");
  });
});

describe("listDownstreamServers", () => {
  it("returns {} for a missing config", () => {
    expect(listDownstreamServers()).toEqual({});
  });
});
