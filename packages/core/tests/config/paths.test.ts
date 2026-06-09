import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock node:os so getConfigDir() sees a controllable HOME.
let mockHome = "/home/tester";
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => mockHome,
  };
});

describe("paths", () => {
  it("expands ~ to home directory", async () => {
    mockHome = "/home/tester";
    const { expandHome } = await import("../../src/config/paths.js");
    expect(expandHome("~/foo")).toBe(join("/home/tester", "foo"));
  });

  it("leaves absolute paths unchanged", async () => {
    const { expandHome } = await import("../../src/config/paths.js");
    expect(expandHome("/tmp/bar")).toBe("/tmp/bar");
  });

  describe("config dir resolution (Habena rename compat)", () => {
    let home: string;
    const savedEnv = { ...process.env };

    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), "habena-home-"));
      mockHome = home;
      delete process.env.HABENA_CONFIG_DIR;
      delete process.env.AGENTGUARD_CONFIG_DIR;
    });

    afterEach(() => {
      rmSync(home, { recursive: true, force: true });
      process.env = { ...savedEnv };
    });

    it("defaults to ~/.habena when neither dir exists", async () => {
      const { getConfigDir } = await import("../../src/config/paths.js");
      expect(getConfigDir()).toBe(join(home, ".habena"));
    });

    it("resolves to ~/.agentguard when only the legacy dir exists", async () => {
      mkdirSync(join(home, ".agentguard"));
      const warn = vi.spyOn(console, "error").mockImplementation(() => {});
      const { getConfigDir } = await import("../../src/config/paths.js");
      expect(getConfigDir()).toBe(join(home, ".agentguard"));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toMatch(/legacy.*\.agentguard/i);
      warn.mockRestore();
    });

    it("prefers ~/.habena when it exists even if legacy also exists", async () => {
      mkdirSync(join(home, ".agentguard"));
      mkdirSync(join(home, ".habena"));
      const warn = vi.spyOn(console, "error").mockImplementation(() => {});
      const { getConfigDir } = await import("../../src/config/paths.js");
      expect(getConfigDir()).toBe(join(home, ".habena"));
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("HABENA_CONFIG_DIR env override takes precedence", async () => {
      const override = join(home, "custom-habena");
      process.env.HABENA_CONFIG_DIR = override;
      mkdirSync(join(home, ".agentguard"));
      const { getConfigDir } = await import("../../src/config/paths.js");
      expect(getConfigDir()).toBe(override);
    });

    it("AGENTGUARD_CONFIG_DIR env override is honored as a fallback", async () => {
      const override = join(home, "custom-legacy");
      process.env.AGENTGUARD_CONFIG_DIR = override;
      const { getConfigDir } = await import("../../src/config/paths.js");
      expect(getConfigDir()).toBe(override);
    });

    it("derived paths sit under the resolved dir", async () => {
      mkdirSync(join(home, ".habena"));
      const { getConfigPath, getAgentsPath, getAuditDbPath, getHostPolicyPath } =
        await import("../../src/config/paths.js");
      expect(getConfigPath()).toBe(join(home, ".habena", "config.yaml"));
      expect(getAgentsPath()).toBe(join(home, ".habena", "agents.yaml"));
      expect(getAuditDbPath()).toBe(join(home, ".habena", "audit.db"));
      expect(getHostPolicyPath()).toBe(join(home, ".habena", "host-policy.yaml"));
    });
  });
});
