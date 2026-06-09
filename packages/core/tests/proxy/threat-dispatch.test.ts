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
});
