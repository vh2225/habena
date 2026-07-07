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

  it("returns 502 when the ipc call rejects (proxy down)", async () => {
    mockHistory.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await GET(req());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});
