import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/agents-registry.server", () => ({ readRegistry: vi.fn() }));
vi.mock("@/lib/audit", () => ({ agentActivity: vi.fn() }));

import { GET } from "./route";
import { readRegistry } from "@/lib/agents-registry.server";
import { agentActivity } from "@/lib/audit";

const mockReg = readRegistry as unknown as ReturnType<typeof vi.fn>;
const mockAct = agentActivity as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => vi.clearAllMocks());

describe("GET /api/agents", () => {
  it("merges registry + activity into summaries", async () => {
    mockReg.mockReturnValue([{ name: "openclaw", mode: "enforced", registered: "2026-06-01", fingerprint: "oc", budgetDaily: 30 }]);
    mockAct.mockReturnValue([{ agentType: "openclaw", total: 2, allow: 2, deny: 0, approval: 0, topTools: [], instancesSeen: 1, lastSeen: "2026-06-09T00:00:00.000Z" }]);
    const res = await GET();
    const body = await res.json();
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]).toMatchObject({ name: "openclaw", status: "registered" });
  });

  it("degrades to empty agents if a reader throws", async () => {
    mockReg.mockImplementation(() => { throw new Error("boom"); });
    mockAct.mockReturnValue([]);
    const res = await GET();
    const body = await res.json();
    expect(body.agents).toEqual([]);
  });
});
