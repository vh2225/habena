import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProxyDispatcher } from "../../src/proxy/server.js";
import { PolicyEngine } from "../../src/policy/engine.js";
import { getPreset } from "../../src/policy/presets.js";
import { CostTracker } from "../../src/cost/tracker.js";
import { BudgetEnforcer } from "../../src/cost/budget.js";
import { AuditLogger } from "../../src/audit/logger.js";
import { InstanceTracker } from "../../src/identity/instances.js";
import { ApprovalQueue } from "../../src/approval/queue.js";

// Sibling harness pattern copied from tests/proxy/server.test.ts: real
// PolicyEngine/CostTracker/BudgetEnforcer/AuditLogger/InstanceTracker, with a
// temp dir for the audit sqlite file cleaned up in afterEach.

const dirs: string[] = [];
const loggers: AuditLogger[] = [];
const queues: ApprovalQueue[] = [];

afterEach(() => {
  for (const q of queues.splice(0)) q.shutdown();
  for (const a of loggers.splice(0)) a.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeAudit(): AuditLogger {
  const dir = mkdtempSync(join(tmpdir(), "agentguard-floor-"));
  dirs.push(dir);
  const audit = new AuditLogger(join(dir, "audit.db"));
  loggers.push(audit);
  return audit;
}

/** User policy that allows write_file — the floor preset (cautious) requires
 * approval for writes, so any escalation observed must come from the floor. */
function userPolicyAllowingWrites(): PolicyEngine {
  return new PolicyEngine([
    { match: { tool: "write_file" }, action: "allow", reason: "user allows writes" },
  ]);
}

function floorEngine(): PolicyEngine {
  const preset = getPreset("cautious");
  if (!preset) throw new Error("cautious preset missing");
  return new PolicyEngine(preset.rules);
}

function baseDeps(active: () => "web" | "telegram" | null, approval?: ApprovalQueue) {
  return {
    policy: userPolicyAllowingWrites(),
    tracker: new CostTracker(),
    budget: new BudgetEnforcer(new CostTracker(), {}),
    audit: makeAudit(),
    instances: new InstanceTracker(),
    approval,
    approvalTimeoutMs: 5000,
    chatFloor: { active, engine: floorEngine() },
  };
}

describe("chat channel policy floor", () => {
  it("keeps the user decision when no chat run is active", async () => {
    const dispatcher = new ProxyDispatcher(baseDeps(() => null));
    const res = await dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "write_file",
      args: { path: "/tmp/x" },
      estimatedCost: 0,
    });
    expect(res.decision.action).toBe("allow");
    expect(res.forwarded).toBe(true);
  });

  it("escalates an allow to the floor's require_approval during a telegram run", async () => {
    const queue = new ApprovalQueue();
    queues.push(queue);
    const dispatcher = new ProxyDispatcher(baseDeps(() => "telegram", queue));

    const pendingPromise = dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "write_file",
      args: { path: "/tmp/x" },
      estimatedCost: 0,
    });
    await new Promise((r) => setTimeout(r, 10));
    const pending = queue.list();
    expect(pending).toHaveLength(1);
    expect(pending[0].decision.action).toBe("require_approval");

    queue.respond(pending[0].id, { choice: "allow_once" });
    const result = await pendingPromise;
    expect(result.decision.action).toBe("allow");
  });

  it("web runs do NOT get the floor", async () => {
    const dispatcher = new ProxyDispatcher(baseDeps(() => "web"));
    const res = await dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "write_file",
      args: { path: "/tmp/x" },
      estimatedCost: 0,
    });
    expect(res.decision.action).toBe("allow");
    expect(res.forwarded).toBe(true);
  });

  it("tags approvals created during a telegram run with origin", async () => {
    const queue = new ApprovalQueue();
    queues.push(queue);
    const dispatcher = new ProxyDispatcher(baseDeps(() => "telegram", queue));

    const pendingPromise = dispatcher.handleToolCall({
      agentType: "openclaw",
      instanceId: "openclaw/test",
      tool: "write_file",
      args: { path: "/tmp/x" },
      estimatedCost: 0,
    });
    await new Promise((r) => setTimeout(r, 10));
    const pending = queue.list();
    expect(pending).toHaveLength(1);
    expect(pending[0].request.origin).toBe("telegram");

    queue.respond(pending[0].id, { choice: "deny" });
    await pendingPromise;
  });
});
