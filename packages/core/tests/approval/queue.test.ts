import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ApprovalQueue } from "../../src/approval/queue.js";
import type { PolicyDecision } from "../../src/policy/decisions.js";
import type { ToolCallRequest } from "../../src/proxy/server.js";

function sampleDecision(): PolicyDecision {
  return {
    action: "require_approval",
    reason: "test",
    tool: "gmail_send",
    enforcement: "soft_mandatory",
    risk_level: "medium",
    tier: "user",
  };
}

function sampleRequest(): ToolCallRequest {
  return {
    agentType: "openclaw",
    instanceId: "openclaw/session-x",
    tool: "gmail_send",
    args: { to: "bob@example.com" },
    estimatedCost: 0,
  };
}

describe("ApprovalQueue", () => {
  let queue: ApprovalQueue;

  beforeEach(() => {
    queue = new ApprovalQueue();
  });

  afterEach(() => {
    queue.shutdown();
  });

  it("assigns unique ids to new pending approvals", async () => {
    const p1 = queue.request(sampleDecision(), sampleRequest(), 60000);
    const p2 = queue.request(sampleDecision(), sampleRequest(), 60000);
    const pending = queue.list();
    expect(pending).toHaveLength(2);
    expect(pending[0].id).not.toBe(pending[1].id);
    queue.respond(pending[0].id, { choice: "deny" });
    queue.respond(pending[1].id, { choice: "deny" });
    await p1;
    await p2;
  });

  it("resolves when respond is called with allow_once", async () => {
    const promise = queue.request(sampleDecision(), sampleRequest(), 60000);
    const [p] = queue.list();
    queue.respond(p.id, { choice: "allow_once" });
    const response = await promise;
    expect(response.choice).toBe("allow_once");
  });

  it("resolves with deny after timeout", async () => {
    vi.useFakeTimers();
    const promise = queue.request(sampleDecision(), sampleRequest(), 100);
    vi.advanceTimersByTime(150);
    const response = await promise;
    expect(response.choice).toBe("deny");
    expect(queue.list()).toHaveLength(0);
    vi.useRealTimers();
  });

  it("removes approval from list after respond", async () => {
    const promise = queue.request(sampleDecision(), sampleRequest(), 60000);
    const [p] = queue.list();
    queue.respond(p.id, { choice: "allow_once" });
    await promise;
    expect(queue.list()).toHaveLength(0);
  });

  it("emits approval_request event when request is made", () => {
    const handler = vi.fn();
    queue.on("approval_request", handler);
    const promise = queue.request(sampleDecision(), sampleRequest(), 60000);
    expect(handler).toHaveBeenCalledOnce();
    const [p] = queue.list();
    queue.respond(p.id, { choice: "deny" });
    return promise;
  });

  it("emits approval_resolved event when respond is called", async () => {
    const handler = vi.fn();
    queue.on("approval_resolved", handler);
    const promise = queue.request(sampleDecision(), sampleRequest(), 60000);
    const [p] = queue.list();
    queue.respond(p.id, { choice: "allow_once" });
    await promise;
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].id).toBe(p.id);
  });

  it("respond on unknown id is a no-op", () => {
    expect(() => queue.respond("missing", { choice: "deny" })).not.toThrow();
  });

  it("configurable timeout_action=allow resolves with allow_once on timeout", async () => {
    vi.useFakeTimers();
    const q = new ApprovalQueue({ timeoutAction: "allow" });
    const promise = q.request(sampleDecision(), sampleRequest(), 100);
    vi.advanceTimersByTime(150);
    const response = await promise;
    expect(response.choice).toBe("allow_once");
    vi.useRealTimers();
    q.shutdown();
  });
});
