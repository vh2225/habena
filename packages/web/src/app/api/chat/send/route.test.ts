import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/chat-ipc", () => ({
  chatSend: vi.fn(),
}));

import { POST } from "./route";
import { chatSend } from "@/lib/chat-ipc";

const mockSend = chatSend as unknown as ReturnType<typeof vi.fn>;
const req = (body: unknown) =>
  new Request("http://localhost/api/chat/send", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/chat/send", () => {
  it("forwards valid text and returns the ack", async () => {
    mockSend.mockResolvedValue({ ok: true });
    const res = await POST(req({ text: "hello" }));
    expect(mockSend).toHaveBeenCalledWith("hello");
    expect((await res.json()).ok).toBe(true);
  });

  it("rejects a missing text field with 400", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rejects an empty/whitespace text with 400", async () => {
    const res = await POST(req({ text: "   " }));
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rejects a non-string text with 400", async () => {
    const res = await POST(req({ text: 42 }));
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rejects text longer than 8000 chars with 400", async () => {
    const res = await POST(req({ text: "x".repeat(8001) }));
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toMatch(/too long/i);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("accepts text exactly at the 8000-char cap", async () => {
    mockSend.mockResolvedValue({ ok: true });
    const res = await POST(req({ text: "x".repeat(8000) }));
    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid JSON with 400 (no crash)", async () => {
    const res = await POST(
      new Request("http://localhost/api/chat/send", { method: "POST", body: "not json" })
    );
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns 502 offline when the proxy is unreachable", async () => {
    mockSend.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await POST(req({ text: "hi" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("offline");
  });
});
