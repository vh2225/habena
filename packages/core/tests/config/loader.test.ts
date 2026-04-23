import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadYaml, loadHostPolicy } from "../../src/config/loader.js";

describe("loader", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads a YAML file", () => {
    const path = join(dir, "test.yaml");
    writeFileSync(path, "foo: bar\nnum: 42\n");
    const result = loadYaml<{ foo: string; num: number }>(path);
    expect(result).toEqual({ foo: "bar", num: 42 });
  });

  it("returns null when file does not exist", () => {
    const result = loadYaml(join(dir, "missing.yaml"));
    expect(result).toBeNull();
  });

  it("throws on invalid YAML", () => {
    const path = join(dir, "bad.yaml");
    writeFileSync(path, "foo: [unclosed");
    expect(() => loadYaml(path)).toThrow();
  });
});

describe("loadHostPolicy", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-host-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty rules when file does not exist", () => {
    const p = join(dir, "host-policy.yaml");
    const result = loadHostPolicy(p);
    expect(result.exists).toBe(false);
    expect(result.rules).toEqual([]);
    expect(result.missingPacks).toEqual([]);
  });

  it("loads rules directly from the file", () => {
    const p = join(dir, "host-policy.yaml");
    writeFileSync(
      p,
      `rules:
  - match: { tool: "fs_delete" }
    action: deny
    enforcement: hard_mandatory
  - match: { tool: "github_push" }
    action: require_approval
`
    );
    const result = loadHostPolicy(p);
    expect(result.exists).toBe(true);
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0].action).toBe("deny");
    expect(result.rules[0].enforcement).toBe("hard_mandatory");
  });

  it("records missing packs without throwing", () => {
    const p = join(dir, "host-policy.yaml");
    writeFileSync(p, `extends:\n  - does-not-exist\nrules: []\n`);
    const result = loadHostPolicy(p);
    expect(result.exists).toBe(true);
    expect(result.missingPacks).toContain("does-not-exist");
  });
});
