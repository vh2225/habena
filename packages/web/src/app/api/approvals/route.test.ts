import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/approval-ipc", () => ({
  proxyRunning: vi.fn(),
  listPending: vi.fn(),
  socketPath: () => "/fake/agentguard.sock",
}));

import { GET } from "./route";
import { proxyRunning, listPending } from "@/lib/approval-ipc";

const mockRunning = proxyRunning as unknown as ReturnType<typeof vi.fn>;
const mockList = listPending as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("GET /api/approvals", () => {
  it("returns ok:false + hint when the proxy isn't running", async () => {
    mockRunning.mockReturnValue(false);
    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.pending).toEqual([]);
    expect(body.hint).toMatch(/habena start/i);
  });

  it("returns the pending list when the proxy is up", async () => {
    mockRunning.mockReturnValue(true);
    mockList.mockResolvedValue([{ id: "x", tool: "fs.write" }]);
    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.pending).toHaveLength(1);
  });

  it("degrades gracefully if the socket errors mid-call", async () => {
    mockRunning.mockReturnValue(true);
    mockList.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/ECONNREFUSED/);
  });
});
