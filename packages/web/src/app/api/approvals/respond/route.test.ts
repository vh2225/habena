import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/approval-ipc", () => ({
  respond: vi.fn(),
}));

import { POST } from "./route";
import { respond } from "@/lib/approval-ipc";

const mockRespond = respond as unknown as ReturnType<typeof vi.fn>;
const req = (body: unknown) =>
  new Request("http://localhost/api/approvals/respond", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/approvals/respond", () => {
  it("rejects an invalid choice with 400", async () => {
    const res = await POST(req({ id: "x", choice: "nuke" }));
    expect(res.status).toBe(400);
    expect(mockRespond).not.toHaveBeenCalled();
  });

  it("rejects a missing id with 400", async () => {
    const res = await POST(req({ choice: "deny" }));
    expect(res.status).toBe(400);
  });

  it("rejects a null JSON body with 400 (no crash)", async () => {
    const res = await POST(req(null));
    expect(res.status).toBe(400);
    expect(mockRespond).not.toHaveBeenCalled();
  });

  it("rejects a non-object (array) body with 400", async () => {
    const res = await POST(req([]));
    expect(res.status).toBe(400);
    expect(mockRespond).not.toHaveBeenCalled();
  });

  it("forwards a valid deny and returns ok", async () => {
    mockRespond.mockResolvedValue({ ok: true });
    const res = await POST(req({ id: "abc", choice: "deny" }));
    expect(mockRespond).toHaveBeenCalledWith("abc", "deny");
    expect((await res.json()).ok).toBe(true);
  });

  it("surfaces ok:false from a stale id (409)", async () => {
    mockRespond.mockResolvedValue({ ok: false, reason: "unknown approval id" });
    const res = await POST(req({ id: "stale", choice: "allow_once" }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toMatch(/unknown/);
  });
});
