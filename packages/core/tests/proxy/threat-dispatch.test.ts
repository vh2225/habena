import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProxyDispatcher } from "../../src/proxy/server.js";
import { ThreatEngine } from "../../src/threat/engine.js";
import { ToolSnapshotStore } from "../../src/threat/snapshots.js";
import { DEFAULT_THREAT_CONFIG } from "../../src/threat/types.js";

function deps(threat: ThreatEngine) {
  const allow = { action: "allow", reason: "ok", tool: "x", enforcement: "advisory", risk_level: "low", tier: "built_in" } as const;
  return {
    policy: { evaluate: () => ({ ...allow }), addSessionOverride() {} } as any,
    budget: { check: () => null } as any,
    tracker: { record() {} } as any,
    audit: { log() {} } as any,
    instances: { recordSpend() {} } as any,
    threat,
  };
}
const engine = () => new ThreatEngine(DEFAULT_THREAT_CONFIG, new ToolSnapshotStore(join(mkdtempSync(join(process.env.TMPDIR || tmpdir(), "td-")), "s.json")));

describe("ProxyDispatcher threat integration", () => {
  it("escalates an allowed call that carries a secret arg", async () => {
    const d = new ProxyDispatcher(deps(engine()));
    const res = await d.handleToolCall({ agentType: "a", instanceId: "i", tool: "read_file", args: { body: "AKIAIOSFODNN7EXAMPLE" }, estimatedCost: 0, mcpServer: "fs" });
    expect(res.decision.action).toBe("deny"); // egress→require_approval, no approval handler → deny
    expect(res.decision.reason).toMatch(/threat:credential_egress/);
    expect(res.forwarded).toBe(false);
  });
  it("leaves a clean allowed call alone", async () => {
    const d = new ProxyDispatcher(deps(engine()));
    const res = await d.handleToolCall({ agentType: "a", instanceId: "i", tool: "read_file", args: { path: "~/notes.md" }, estimatedCost: 0, mcpServer: "fs" });
    expect(res.decision.action).toBe("allow");
    expect(res.forwarded).toBe(true);
  });

  it("warn-mode findings reach the audit log even when policy allows with mandatory enforcement", async () => {
    // warn → advisory allow, which loses stricter() to a soft_mandatory policy
    // allow; the threat reason must still be carried into the audit entry.
    const warnEngine = new ThreatEngine(
      { ...DEFAULT_THREAT_CONFIG, credential_egress: "warn" },
      new ToolSnapshotStore(join(mkdtempSync(join(process.env.TMPDIR || tmpdir(), "td-")), "s.json"))
    );
    const d = deps(warnEngine);
    d.policy = {
      evaluate: () => ({ action: "allow", reason: "user rule", tool: "x", enforcement: "soft_mandatory", risk_level: "medium", tier: "user" }),
      addSessionOverride() {},
    } as any;
    const logged: any[] = [];
    d.audit = { log: (e: any) => logged.push(e) } as any;

    const res = await new ProxyDispatcher(d).handleToolCall({
      agentType: "a", instanceId: "i", tool: "read_file",
      args: { body: "AKIAIOSFODNN7EXAMPLE" }, estimatedCost: 0, mcpServer: "fs",
    });
    expect(res.decision.action).toBe("allow"); // warn never blocks
    expect(res.forwarded).toBe(true);
    expect(logged).toHaveLength(1);
    expect(logged[0].reason).toMatch(/threat:credential_egress/);
  });
});
