import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatEventWire } from "@/lib/approval-protocol";

const closeFn = vi.fn();
let capturedOnEvent: ((ev: ChatEventWire) => void) | undefined;
let capturedOnError: ((err: Error) => void) | undefined;

vi.mock("@/lib/chat-ipc", () => ({
  chatSubscribe: vi.fn((onEvent: (ev: ChatEventWire) => void, onError: (err: Error) => void) => {
    capturedOnEvent = onEvent;
    capturedOnError = onError;
    return closeFn;
  }),
}));

import { GET } from "./route";
import { chatSubscribe } from "@/lib/chat-ipc";

const mockSubscribe = chatSubscribe as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  capturedOnEvent = undefined;
  capturedOnError = undefined;
});

describe("GET /api/chat/stream", () => {
  it("responds with an event-stream content type", async () => {
    const res = await GET();
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    await res.body?.cancel();
  });

  it("subscribes exactly once per request", async () => {
    const res = await GET();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    await res.body?.cancel();
  });

  it("streams chatSubscribe events as SSE `data:` frames", async () => {
    const res = await GET();
    const reader = res.body!.getReader();
    const event: ChatEventWire = { kind: "status", state: "idle", at: "2026-01-01T00:00:00.000Z" };
    capturedOnEvent!(event);
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toBe(`data: ${JSON.stringify(event)}\n\n`);
    await reader.cancel();
  });

  it("invokes the subscription closer when the reader is cancelled", async () => {
    const res = await GET();
    const reader = res.body!.getReader();
    await reader.cancel();
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it("ignores events delivered after the reader is cancelled (no throw)", async () => {
    const res = await GET();
    const reader = res.body!.getReader();
    await reader.cancel();
    expect(closeFn).toHaveBeenCalledTimes(1);
    const late: ChatEventWire = { kind: "assistant_final", text: "late", at: "2026-01-01T00:00:01.000Z" };
    // Delivery on an already-cancelled stream must not throw inside the IPC path.
    expect(() => capturedOnEvent!(late)).not.toThrow();
  });

  it("closes the stream controller when chatSubscribe reports an error", async () => {
    const res = await GET();
    const reader = res.body!.getReader();
    capturedOnError!(new Error("proxy closed"));
    const { done } = await reader.read();
    expect(done).toBe(true);
  });
});
