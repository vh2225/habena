import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/setup-status", () => ({ readSetupStatus: vi.fn() }));

import { GET } from "./route";
import { readSetupStatus } from "@/lib/setup-status";

const mockRead = readSetupStatus as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => vi.clearAllMocks());

describe("GET /api/setup-status", () => {
  it("returns the setup status", async () => {
    mockRead.mockReturnValue({ configExists: true, downstreams: ["filesystem"], agents: ["openclaw"], telegramConfigured: false, proxyRunning: true, decisionCount: 2 });
    const res = await GET();
    const body = await res.json();
    expect(body.configExists).toBe(true);
    expect(body.downstreams).toEqual(["filesystem"]);
    expect(body.decisionCount).toBe(2);
  });

  it("degrades to an all-empty status if the reader throws", async () => {
    mockRead.mockImplementation(() => { throw new Error("boom"); });
    const res = await GET();
    const body = await res.json();
    expect(body.configExists).toBe(false);
    expect(body.downstreams).toEqual([]);
    expect(body.proxyRunning).toBe(false);
  });
});
