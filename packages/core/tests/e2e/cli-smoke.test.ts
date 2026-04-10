import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = "node dist/cli/index.js";

describe("CLI smoke", () => {
  let homeDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "agentguard-home-"));
    env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("init creates config files", () => {
    execSync(`${CLI} init`, { env, cwd: "." });
    expect(existsSync(join(homeDir, ".agentguard", "config.yaml"))).toBe(true);
    expect(existsSync(join(homeDir, ".agentguard", "agents.yaml"))).toBe(true);
  });

  it("agent add then list shows the agent", () => {
    execSync(`${CLI} init`, { env });
    execSync(`${CLI} agent add --name openclaw --budget-daily 30`, { env });
    const output = execSync(`${CLI} agent list`, { env }).toString();
    expect(output).toContain("openclaw");
    expect(output).toContain("$30/day");
  });

  it("logs with no entries shows empty message", () => {
    execSync(`${CLI} init`, { env });
    const output = execSync(`${CLI} logs`, { env }).toString();
    expect(output.toLowerCase()).toContain("no audit");
  });
});
