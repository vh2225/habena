import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/chat-ipc", () => ({
  chatHistory: vi.fn(),
}));

import { GET } from "./route";
import { chatHistory } from "@/lib/chat-ipc";

const mockHistory = chatHistory as unknown as ReturnType<typeof vi.fn>;
const req = (query = "") => new Request(`http://localhost/api/chat/history${query}`);

beforeEach(() => vi.clearAllMocks());

describe("GET /api/chat/history", () => {
  it("returns the events from the ipc client", async () => {
    mockHistory.mockResolvedValue([{ kind: "user", channel: "web", text: "hi", at: "2026-01-01T00:00:00.000Z" }]);
    const res = await GET(req());
    const body = await res.json();
    expect(body.events).toHaveLength(1);
  });

  it("forwards a numeric limit query param", async () => {
    mockHistory.mockResolvedValue([]);
    await GET(req("?limit=50"));
    expect(mockHistory).toHaveBeenCalledWith(50);
  });

  it("defaults the limit when absent", async () => {
    mockHistory.mockResolvedValue([]);
    await GET(req());
    expect(mockHistory).toHaveBeenCalledWith(50);
  });

  it("defaults a negative limit to 50", async () => {
    mockHistory.mockResolvedValue([]);
    await GET(req("?limit=-5"));
    expect(mockHistory).toHaveBeenCalledWith(50);
  });

  it("defaults a zero limit to 50", async () => {
    mockHistory.mockResolvedValue([]);
    await GET(req("?limit=0"));
    expect(mockHistory).toHaveBeenCalledWith(50);
  });

  it("clamps an oversized limit to 500", async () => {
    mockHistory.mockResolvedValue([]);
    await GET(req("?limit=9999"));
    expect(mockHistory).toHaveBeenCalledWith(500);
  });

  it("returns 502 with a masked reason when the ipc call rejects (proxy down)", async () => {
    mockHistory.mockRejectedValue(new Error("connect ECONNREFUSED /run/user/1000/secret-name.sock"));
    const res = await GET(req());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    // Never pass the IPC layer's rejection text through to the client.
    expect(body.reason).toBe("offline");
  });
});
