import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readOpenclawConfig,
  writeOpenclawConfig,
  migrateServersToAgentGuard,
  backupConfig,
  installOpenclaw,
  uninstallOpenclaw,
  type OpenclawConfig,
} from "../../src/install/openclaw.js";
import { parse as parseYaml } from "yaml";

describe("openclaw install module", () => {
  let dir: string;
  let openclawPath: string;
  let agentguardPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ag-install-"));
    openclawPath = join(dir, "openclaw.json");
    agentguardPath = join(dir, "config.yaml");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("readOpenclawConfig", () => {
    it("returns null when file does not exist", () => {
      expect(readOpenclawConfig(openclawPath)).toBeNull();
    });

    it("parses a valid config", () => {
      writeFileSync(openclawPath, JSON.stringify({ mcp: { servers: { a: { command: "x" } } } }));
      const config = readOpenclawConfig(openclawPath);
      expect(config?.mcp?.servers?.a).toBeDefined();
    });
  });

  describe("backupConfig", () => {
    it("creates a dated backup next to the original", () => {
      writeFileSync(openclawPath, "{}");
      const backup = backupConfig(openclawPath);
      expect(backup).toMatch(/openclaw\.json\.backup-/);
      expect(existsSync(backup)).toBe(true);
    });
  });

  describe("migrateServersToAgentGuard", () => {
    it("moves stdio servers into migratedServers and replaces them with agentguard entry", () => {
      const config: OpenclawConfig = {
        mcp: {
          servers: {
            filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
            github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "xxx" } },
          },
        },
      };
      const result = migrateServersToAgentGuard(config, "/usr/local/bin/habena");
      expect(Object.keys(result.migratedServers).sort()).toEqual(["filesystem", "github"]);
      expect(result.newOpenclawConfig.mcp?.servers?.habena).toBeDefined();
      const ag = result.newOpenclawConfig.mcp?.servers?.habena as any;
      expect(ag.command).toBe("node");
      expect(ag.args).toContain("/usr/local/bin/habena");
      // original stdio servers removed
      expect(result.newOpenclawConfig.mcp?.servers?.filesystem).toBeUndefined();
      expect(result.newOpenclawConfig.mcp?.servers?.github).toBeUndefined();
    });

    it("preserves HTTP servers in place (Phase 2 doesn't forward http yet)", () => {
      const config: OpenclawConfig = {
        mcp: {
          servers: {
            filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
            "remote-api": { url: "https://mcp.example.com", transport: "sse" },
          },
        },
      };
      const result = migrateServersToAgentGuard(config, "/bin/habena");
      expect(Object.keys(result.migratedServers)).toEqual(["filesystem"]);
      expect(result.newOpenclawConfig.mcp?.servers?.["remote-api"]).toBeDefined();
      expect(result.newOpenclawConfig.mcp?.servers?.habena).toBeDefined();
    });

    it("handles empty mcp.servers gracefully", () => {
      const config: OpenclawConfig = { mcp: { servers: {} } };
      const result = migrateServersToAgentGuard(config, "/bin/habena");
      expect(Object.keys(result.migratedServers)).toEqual([]);
      expect(result.newOpenclawConfig.mcp?.servers?.habena).toBeDefined();
    });

    it("replaces a legacy `agentguard` entry with `habena` (not migrated as a downstream)", () => {
      const config: OpenclawConfig = {
        mcp: {
          servers: {
            agentguard: { command: "node", args: ["/old/agentguard", "start"] },
            filesystem: { command: "npx", args: ["-y", "fs"] },
          },
        },
      };
      const result = migrateServersToAgentGuard(config, "/new/habena");
      // legacy entry is not pulled into downstreams
      expect(Object.keys(result.migratedServers)).toEqual(["filesystem"]);
      // legacy key dropped, canonical key written
      expect(result.newOpenclawConfig.mcp?.servers?.agentguard).toBeUndefined();
      const ag = result.newOpenclawConfig.mcp?.servers?.habena as any;
      expect(ag.args).toContain("/new/habena");
    });

    it("preserves unknown top-level fields", () => {
      const config: OpenclawConfig = {
        mcp: { servers: { a: { command: "x" } } },
        agents: { default: "claude-sonnet" },
        someOtherField: 42,
      } as any;
      const result = migrateServersToAgentGuard(config, "/bin/ag");
      expect((result.newOpenclawConfig as any).agents).toEqual({ default: "claude-sonnet" });
      expect((result.newOpenclawConfig as any).someOtherField).toBe(42);
    });
  });

  describe("installOpenclaw", () => {
    it("throws when OpenClaw config does not exist", async () => {
      await expect(
        installOpenclaw({
          openclawConfigPath: openclawPath,
          agentguardBinaryPath: "/bin/ag",
          agentguardConfigPath: agentguardPath,
        })
      ).rejects.toThrow(/not installed|onboard/i);
    });

    it("migrates servers and writes both configs", async () => {
      writeFileSync(
        openclawPath,
        JSON.stringify({
          mcp: {
            servers: {
              filesystem: { command: "npx", args: ["-y", "server-filesystem", "/tmp"] },
            },
          },
        })
      );
      const result = await installOpenclaw({
        openclawConfigPath: openclawPath,
        agentguardBinaryPath: "/bin/agentguard",
        agentguardConfigPath: agentguardPath,
      });

      expect(result.migratedServers).toEqual(["filesystem"]);
      expect(result.backupPath).toBeTruthy();
      expect(existsSync(result.backupPath!)).toBe(true);

      const updated = JSON.parse(readFileSync(openclawPath, "utf8"));
      expect(updated.mcp.servers.habena).toBeDefined();
      expect(updated.mcp.servers.filesystem).toBeUndefined();

      const agConfig = parseYaml(readFileSync(agentguardPath, "utf8"));
      expect(agConfig.mcp_servers.filesystem).toBeDefined();
      expect(agConfig.mcp_servers.filesystem.command).toBe("npx");
    });

    it("refuses to overwrite an existing habena entry without --force", async () => {
      writeFileSync(
        openclawPath,
        JSON.stringify({ mcp: { servers: { habena: { command: "existing" } } } })
      );
      await expect(
        installOpenclaw({
          openclawConfigPath: openclawPath,
          agentguardBinaryPath: "/bin/ag",
          agentguardConfigPath: agentguardPath,
        })
      ).rejects.toThrow(/already installed|force/i);
    });

    it("refuses to overwrite a legacy agentguard entry without --force", async () => {
      writeFileSync(
        openclawPath,
        JSON.stringify({ mcp: { servers: { agentguard: { command: "existing" } } } })
      );
      await expect(
        installOpenclaw({
          openclawConfigPath: openclawPath,
          agentguardBinaryPath: "/bin/ag",
          agentguardConfigPath: agentguardPath,
        })
      ).rejects.toThrow(/already installed|force/i);
    });

    it("--force migrates a legacy agentguard entry to habena", async () => {
      writeFileSync(
        openclawPath,
        JSON.stringify({
          mcp: {
            servers: {
              agentguard: { command: "old-path" },
              filesystem: { command: "npx", args: ["-y", "server-filesystem"] },
            },
          },
        })
      );
      const result = await installOpenclaw({
        openclawConfigPath: openclawPath,
        agentguardBinaryPath: "/new/habena",
        agentguardConfigPath: agentguardPath,
        force: true,
      });
      expect(result.migratedServers).toEqual(["filesystem"]);
      const updated = JSON.parse(readFileSync(openclawPath, "utf8"));
      expect(updated.mcp.servers.agentguard).toBeUndefined();
      expect(updated.mcp.servers.habena.args[0]).toBe("/new/habena");
    });

    it("dry run does not write any files", async () => {
      writeFileSync(
        openclawPath,
        JSON.stringify({ mcp: { servers: { filesystem: { command: "npx", args: ["-y", "server-filesystem"] } } } })
      );
      const result = await installOpenclaw({
        openclawConfigPath: openclawPath,
        agentguardBinaryPath: "/bin/ag",
        agentguardConfigPath: agentguardPath,
        dryRun: true,
      });
      expect(result.migratedServers).toEqual(["filesystem"]);
      // verify unchanged
      const unchanged = JSON.parse(readFileSync(openclawPath, "utf8"));
      expect(unchanged.mcp.servers.filesystem).toBeDefined();
      expect(unchanged.mcp.servers.habena).toBeUndefined();
      expect(existsSync(agentguardPath)).toBe(false);
    });

    it("merges into existing agentguard config (creates if missing)", async () => {
      writeFileSync(
        openclawPath,
        JSON.stringify({ mcp: { servers: { filesystem: { command: "npx", args: ["-y", "fs"] } } } })
      );
      writeFileSync(
        agentguardPath,
        `rules:
  - match:
      tool: "*"
    action: allow

mcp_servers:
  existing:
    command: /bin/existing
`
      );
      await installOpenclaw({
        openclawConfigPath: openclawPath,
        agentguardBinaryPath: "/bin/ag",
        agentguardConfigPath: agentguardPath,
      });
      const agConfig = parseYaml(readFileSync(agentguardPath, "utf8"));
      expect(agConfig.mcp_servers.existing).toBeDefined();
      expect(agConfig.mcp_servers.filesystem).toBeDefined();
    });
  });

  describe("uninstallOpenclaw", () => {
    it("restores from the latest backup", async () => {
      writeFileSync(
        openclawPath,
        JSON.stringify({ mcp: { servers: { fs: { command: "original" } } } })
      );
      await installOpenclaw({
        openclawConfigPath: openclawPath,
        agentguardBinaryPath: "/bin/ag",
        agentguardConfigPath: agentguardPath,
      });
      // verify it was replaced
      let current = JSON.parse(readFileSync(openclawPath, "utf8"));
      expect(current.mcp.servers.habena).toBeDefined();
      expect(current.mcp.servers.fs).toBeUndefined();
      // now uninstall
      const result = await uninstallOpenclaw({ openclawConfigPath: openclawPath });
      expect(result.restored).toBe(true);
      current = JSON.parse(readFileSync(openclawPath, "utf8"));
      expect(current.mcp.servers.fs).toBeDefined();
      expect(current.mcp.servers.habena).toBeUndefined();
    });

    it("throws when no backup exists", async () => {
      writeFileSync(openclawPath, "{}");
      await expect(
        uninstallOpenclaw({ openclawConfigPath: openclawPath })
      ).rejects.toThrow(/backup/i);
    });
  });
});
