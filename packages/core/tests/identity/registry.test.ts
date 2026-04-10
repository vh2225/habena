import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentRegistry } from "../../src/identity/registry.js";
import type { AgentType } from "../../src/identity/types.js";

describe("AgentRegistry", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-"));
    path = join(dir, "agents.yaml");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts empty when file does not exist", () => {
    const reg = new AgentRegistry(path);
    expect(reg.list()).toEqual([]);
  });

  it("registers and looks up an agent", () => {
    const reg = new AgentRegistry(path);
    const agent: AgentType = {
      name: "openclaw",
      fingerprint: "oc-v1-test",
      registered: "2026-04-09",
      mode: "enforced",
      permissions: { budget: { daily: 30 } },
    };
    reg.register(agent);
    const found = reg.lookup("openclaw");
    expect(found).toEqual(agent);
  });

  it("persists to file and reloads", () => {
    const reg1 = new AgentRegistry(path);
    reg1.register({
      name: "openclaw",
      fingerprint: "oc-v1-test",
      registered: "2026-04-09",
      mode: "enforced",
      permissions: { budget: { daily: 30 } },
    });
    reg1.save();

    const reg2 = new AgentRegistry(path);
    expect(reg2.lookup("openclaw")?.fingerprint).toBe("oc-v1-test");
  });

  it("returns undefined for unknown agent", () => {
    const reg = new AgentRegistry(path);
    expect(reg.lookup("nope")).toBeUndefined();
  });

  it("lists all registered agents", () => {
    const reg = new AgentRegistry(path);
    reg.register({
      name: "openclaw",
      fingerprint: "oc-v1",
      registered: "2026-04-09",
      mode: "enforced",
      permissions: {},
    });
    reg.register({
      name: "research-bot",
      fingerprint: "rb-v1",
      registered: "2026-04-09",
      mode: "learning",
      permissions: {},
    });
    expect(reg.list().map((a) => a.name).sort()).toEqual(["openclaw", "research-bot"]);
  });

  it("lookupByFingerprint finds agent by fingerprint", () => {
    const reg = new AgentRegistry(path);
    reg.register({
      name: "openclaw",
      fingerprint: "unique-fp-123",
      registered: "2026-04-09",
      mode: "enforced",
      permissions: {},
    });
    expect(reg.lookupByFingerprint("unique-fp-123")?.name).toBe("openclaw");
    expect(reg.lookupByFingerprint("missing")).toBeUndefined();
  });

  it("createVariant clones an agent with overrides", () => {
    const reg = new AgentRegistry(path);
    reg.register({
      name: "openclaw",
      fingerprint: "oc-v1",
      registered: "2026-04-09",
      mode: "enforced",
      permissions: { budget: { daily: 30 } },
    });
    const variant = reg.createVariant("openclaw-work", "openclaw", {
      budget: { daily: 100 },
    });
    expect(variant.permissions.budget?.daily).toBe(100);
    expect(variant.name).toBe("openclaw-work");
  });

  it("createVariant throws when base agent missing", () => {
    const reg = new AgentRegistry(path);
    expect(() => reg.createVariant("new", "missing", {})).toThrow();
  });
});
