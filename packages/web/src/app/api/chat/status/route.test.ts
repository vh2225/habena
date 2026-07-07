import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/chat-ipc", () => ({
  chatStatus: vi.fn(),
  chatRearm: vi.fn(),
}));

import { GET, POST } from "./route";
import { chatStatus, chatRearm } from "@/lib/chat-ipc";

const mockStatus = chatStatus as unknown as ReturnType<typeof vi.fn>;
const mockRearm = chatRearm as unknown as ReturnType<typeof vi.fn>;
const req = (body: unknown) =>
  new Request("http://localhost/api/chat/status", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => vi.clearAllMocks());

describe("GET /api/chat/status", () => {
  it("returns the status payload", async () => {
    mockStatus.mockResolvedValue({ bridgeUp: true, running: true, disarmed: [], queueDepth: 0 });
    const res = await GET();
    const body = await res.json();
    expect(body.bridgeUp).toBe(true);
    expect(body.disarmed).toEqual([]);
  });

  it("returns 502 with a masked reason when the ipc call rejects (proxy down)", async () => {
    mockStatus.mockRejectedValue(new Error("connect ECONNREFUSED /run/user/1000/secret-name.sock"));
    const res = await GET();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    // Never pass the IPC layer's rejection text through to the client.
    expect(body.reason).toBe("offline");
  });
});

describe("POST /api/chat/status (rearm)", () => {
  it("rearms a valid channel", async () => {
    mockRearm.mockResolvedValue({ ok: true });
    const res = await POST(req({ rearm: "web" }));
    expect(mockRearm).toHaveBeenCalledWith("web");
    expect((await res.json()).ok).toBe(true);
  });

  it("rearms telegram too", async () => {
    mockRearm.mockResolvedValue({ ok: true });
    await POST(req({ rearm: "telegram" }));
    expect(mockRearm).toHaveBeenCalledWith("telegram");
  });

  it("rejects an invalid channel with 400", async () => {
    const res = await POST(req({ rearm: "sms" }));
    expect(res.status).toBe(400);
    expect(mockRearm).not.toHaveBeenCalled();
  });

  it("rejects a missing rearm field with 400", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(mockRearm).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON with 400 (no crash)", async () => {
    const res = await POST(
      new Request("http://localhost/api/chat/status", { method: "POST", body: "not json" })
    );
    expect(res.status).toBe(400);
    expect(mockRearm).not.toHaveBeenCalled();
  });

  it("returns 502 with a masked reason when the ipc call rejects (proxy down)", async () => {
    mockRearm.mockRejectedValue(new Error("connect ECONNREFUSED /run/user/1000/secret-name.sock"));
    const res = await POST(req({ rearm: "web" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    // Never pass the IPC layer's rejection text through to the client.
    expect(body.reason).toBe("offline");
  });
});
