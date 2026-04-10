import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadYaml } from "../../src/config/loader.js";

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
