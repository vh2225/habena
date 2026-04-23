import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// Full-CLI smoke test for `agentguard policy explain`. Exercises the
// bit most likely to break silently: argument parsing + exit code +
// that the engine's decision actually makes it to stdout in both human
// and --json shapes.

const CLI = join(process.cwd(), "dist", "cli", "index.js");

function runCli(args: string[], tmpConfigDir?: string) {
  // Use a per-test config dir to avoid reading the real ~/.agentguard.
  const env = { ...process.env };
  if (tmpConfigDir) {
    env.HOME = tmpConfigDir;
    // fallback for code paths that use homedir() directly
    env.USERPROFILE = tmpConfigDir;
  }
  return spawnSync("node", [CLI, ...args], {
    env,
    encoding: "utf8",
    timeout: 10_000,
  });
}

describe("policy explain (CLI smoke)", () => {
  it("errors without an argument or --tool", () => {
    const dir = mkdtempSync(join(tmpdir(), "ag-explain-"));
    try {
      const r = runCli(["policy", "explain"], dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Provide a JSON argument or --tool/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("errors on non-JSON positional arg", () => {
    const dir = mkdtempSync(join(tmpdir(), "ag-explain-"));
    try {
      const r = runCli(["policy", "explain", "not-json"], dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/not valid JSON/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns deny on a hard-boundary match (empty config)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ag-explain-"));
    try {
      const r = runCli(
        [
          "policy",
          "explain",
          "--json",
          '{"tool":"shell_execute","args":{"command":"rm -rf /"}}',
        ],
        dir
      );
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.decision.action).toBe("deny");
      expect(parsed.decision.tier).toBe("built_in");
      expect(parsed.decision.enforcement).toBe("hard_mandatory");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("respects host-policy floor when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "ag-explain-"));
    const configDir = join(dir, ".agentguard");
    try {
      // config.yaml says allow everything.
      // host-policy.yaml says deny gmail_send.
      // explain should return deny with tier=host.
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "config.yaml"),
        `rules:\n  - match: { tool: "*" }\n    action: allow\n`
      );
      writeFileSync(
        join(configDir, "host-policy.yaml"),
        `rules:\n  - match: { tool: "gmail_send" }\n    action: deny\n    reason: "host floor"\n`
      );
      const r = runCli(
        ["policy", "explain", "--json", '{"tool":"gmail_send","args":{}}'],
        dir
      );
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.decision.action).toBe("deny");
      expect(parsed.decision.tier).toBe("host");
      expect(parsed.decision.reason).toBe("host floor");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
