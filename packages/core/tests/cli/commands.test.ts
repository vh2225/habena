import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

// Full-CLI tests for the high-traffic commands. Each test gets a fresh HOME
// so ~/.habena is isolated; same harness as policy-explain.test.ts.

const CLI = join(process.cwd(), "dist", "cli", "index.js");

let home: string;

function run(args: string[]) {
  return spawnSync("node", [CLI, ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf8",
    timeout: 15_000,
  });
}

beforeEach(() => {
  home = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "habena-cli-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("init", () => {
  it("creates config + agents files and refuses to overwrite without --force", () => {
    const first = run(["init"]);
    expect(first.status).toBe(0);
    expect(existsSync(join(home, ".habena", "config.yaml"))).toBe(true);
    expect(existsSync(join(home, ".habena", "agents.yaml"))).toBe(true);
    const config = readFileSync(join(home, ".habena", "config.yaml"), "utf8");
    expect(config).toContain("per_minute: 120"); // call-rate guard on by default

    const second = run(["init"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("already exists");
  });

  it("--force rewrites an existing config", () => {
    run(["init"]);
    const forced = run(["init", "--force"]);
    expect(forced.status).toBe(0);
    expect(forced.stdout).toContain("✓ Created");
  });
});

describe("agent", () => {
  it("add registers an agent that list shows with its budget", () => {
    run(["init"]);
    const add = run(["agent", "add", "--name", "openclaw", "--budget-daily", "30"]);
    expect(add.status).toBe(0);
    expect(add.stdout).toContain("openclaw");

    const list = run(["agent", "list"]);
    expect(list.status).toBe(0);
    expect(list.stdout).toContain("openclaw");
    expect(list.stdout).toContain("$30/day");
  });
});

describe("policy preset", () => {
  it("--dry-run prints the would-be config without writing", () => {
    run(["init"]);
    const before = readFileSync(join(home, ".habena", "config.yaml"), "utf8");
    const dry = run(["policy", "preset", "deny-all", "--dry-run"]);
    expect(dry.status).toBe(0);
    const after = readFileSync(join(home, ".habena", "config.yaml"), "utf8");
    expect(after).toBe(before); // untouched
  });

  it("--force applies a preset and leaves a backup", () => {
    run(["init"]);
    const apply = run(["policy", "preset", "deny-all", "--force"]);
    expect(apply.status).toBe(0);
    const config = readFileSync(join(home, ".habena", "config.yaml"), "utf8");
    expect(config).toContain("deny");
  });

  it("rejects an unknown preset with a non-zero exit", () => {
    run(["init"]);
    const bad = run(["policy", "preset", "yolo"]);
    expect(bad.status).toBe(1);
  });
});

describe("downstream", () => {
  it("list shows the empty state, add filesystem persists, remove deletes", () => {
    run(["init"]);
    expect(run(["downstream", "list"]).stdout).toContain("No downstream");

    mkdirSync(join(home, "ws")); // the command validates the directory exists
    const add = run(["downstream", "add", "filesystem", join(home, "ws")]);
    expect(add.status).toBe(0);
    expect(run(["downstream", "list"]).stdout).toContain("filesystem");

    const rm = run(["downstream", "remove", "filesystem"]);
    expect(rm.status).toBe(0);
    expect(run(["downstream", "list"]).stdout).toContain("No downstream");
  });
});

describe("logs", () => {
  it("reports cleanly when there are no audit entries", () => {
    run(["init"]);
    const logs = run(["logs"]);
    expect(logs.status).toBe(0);
    expect(logs.stdout).toContain("No audit entries");
  });
});
