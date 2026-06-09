import { describe, it, expect } from "vitest";
import { mergeAgents, type RegistryAgent, type AgentActivity } from "./agents";

const reg = (over: Partial<RegistryAgent> = {}): RegistryAgent => ({
  name: "openclaw", mode: "enforced", registered: "2026-06-01", fingerprint: "oc-abc", budgetDaily: 30, ...over,
});
const act = (over: Partial<AgentActivity> = {}): AgentActivity => ({
  agentType: "openclaw", total: 5, allow: 3, deny: 1, approval: 1, topTools: [{ tool: "fs.read", count: 3 }], instancesSeen: 2, lastSeen: "2026-06-09T12:00:00.000Z", ...over,
});

describe("mergeAgents", () => {
  it("marks a registered agent with activity as 'registered'", () => {
    const [a] = mergeAgents([reg()], [act()]);
    expect(a.status).toBe("registered");
    expect(a.decisions).toEqual({ total: 5, allow: 3, deny: 1, approval: 1 });
    expect(a.budgetDaily).toBe(30);
    expect(a.mode).toBe("enforced");
  });

  it("marks a registered agent with no activity as 'idle'", () => {
    const [a] = mergeAgents([reg()], []);
    expect(a.status).toBe("idle");
    expect(a.decisions.total).toBe(0);
    expect(a.lastSeen).toBeNull();
  });

  it("marks an agent seen in audit but not registered as 'observed'", () => {
    const [a] = mergeAgents([], [act({ agentType: "rogue" })]);
    expect(a.name).toBe("rogue");
    expect(a.status).toBe("observed");
    expect(a.mode).toBeNull();
    expect(a.budgetDaily).toBeNull();
  });

  it("sorts by total decisions desc, then name", () => {
    const out = mergeAgents(
      [reg({ name: "a" }), reg({ name: "b" })],
      [act({ agentType: "a", total: 1 }), act({ agentType: "b", total: 9 })]
    );
    expect(out.map((x) => x.name)).toEqual(["b", "a"]);
  });
});
