import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listPacks, getPack, resolveExtends } from "../../src/policy/packs.js";

describe("rule packs", () => {
  let tmp: string;
  let userDir: string;
  let shippedDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ag-packs-"));
    userDir = join(tmp, "user");
    shippedDir = join(tmp, "shipped");
    mkdirSync(userDir);
    mkdirSync(shippedDir);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("listPacks returns packs sorted by name", () => {
    writeFileSync(join(shippedDir, "b.yaml"), "name: b\nrules:\n  - match: {tool: b}\n    action: allow\n");
    writeFileSync(join(shippedDir, "a.yaml"), "name: a\nrules: []\n");
    const found = listPacks([shippedDir]);
    expect(found.map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("user dir packs override shipped with the same name", () => {
    writeFileSync(
      join(shippedDir, "gmail-readonly.yaml"),
      "name: gmail-readonly\ndescription: shipped\nrules: []\n"
    );
    writeFileSync(
      join(userDir, "gmail-readonly.yaml"),
      "name: gmail-readonly\ndescription: user override\nrules: []\n"
    );
    const pack = getPack("gmail-readonly", [shippedDir, userDir]);
    expect(pack?.description).toBe("user override");
  });

  it("skips files that fail to parse", () => {
    writeFileSync(join(shippedDir, "good.yaml"), "name: good\nrules: []\n");
    writeFileSync(join(shippedDir, "broken.yaml"), "name: broken\nrules: [this is not: valid: yaml\n");
    const packs = listPacks([shippedDir]);
    expect(packs.map((p) => p.name)).toEqual(["good"]);
  });

  it("resolveExtends appends pack rules in declaration order", () => {
    writeFileSync(
      join(shippedDir, "a.yaml"),
      "name: a\nrules:\n  - match: {tool: a1}\n    action: allow\n  - match: {tool: a2}\n    action: deny\n"
    );
    writeFileSync(
      join(shippedDir, "b.yaml"),
      "name: b\nrules:\n  - match: {tool: b1}\n    action: allow\n"
    );
    const { rules, missing } = resolveExtends(["a", "b"], [shippedDir]);
    expect(missing).toEqual([]);
    expect(rules.map((r) => r.match.tool)).toEqual(["a1", "a2", "b1"]);
  });

  it("resolveExtends reports missing packs instead of throwing", () => {
    writeFileSync(join(shippedDir, "exists.yaml"), "name: exists\nrules: []\n");
    const { rules, missing } = resolveExtends(["exists", "nonexistent"], [shippedDir]);
    expect(rules).toEqual([]);
    expect(missing).toEqual(["nonexistent"]);
  });

  it("tolerates .yml extension alongside .yaml", () => {
    writeFileSync(join(shippedDir, "one.yml"), "name: one\nrules: []\n");
    const pack = getPack("one", [shippedDir]);
    expect(pack?.name).toBe("one");
  });
});
