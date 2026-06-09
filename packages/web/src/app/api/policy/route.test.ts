import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/policy.server", () => ({ readPolicy: vi.fn() }));

import { GET } from "./route";
import { readPolicy } from "@/lib/policy.server";

const mockRead = readPolicy as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => vi.clearAllMocks());

describe("GET /api/policy", () => {
  it("returns the policy view", async () => {
    mockRead.mockReturnValue({ configured: true, budget: { daily: 50, monthly: null, perSession: null, perRequest: null, onExceed: "deny", alertAt: null }, rules: [], extendsPacks: [], approval: null, downstreams: [] });
    const res = await GET();
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.budget.daily).toBe(50);
  });

  it("degrades to a not-configured view if the reader throws", async () => {
    mockRead.mockImplementation(() => { throw new Error("boom"); });
    const res = await GET();
    const body = await res.json();
    expect(body.configured).toBe(false);
    expect(body.rules).toEqual([]);
  });
});
