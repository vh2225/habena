import { describe, it, expect } from "vitest";
import { encode, decodeLines } from "./approval-protocol";

describe("approval-protocol", () => {
  it("encodes a client message as one newline-terminated JSON line", () => {
    expect(encode({ type: "list_pending" })).toBe('{"type":"list_pending"}\n');
  });

  it("decodes complete lines and preserves a partial remainder", () => {
    const buf = '{"type":"pending_list","pending":[]}\n{"type":"hel';
    const { messages, remainder } = decodeLines(buf);
    expect(messages).toEqual([{ type: "pending_list", pending: [] }]);
    expect(remainder).toBe('{"type":"hel');
  });

  it("skips malformed lines without throwing", () => {
    const { messages } = decodeLines("not json\n{\"type\":\"respond_ack\",\"id\":\"x\",\"ok\":true}\n");
    expect(messages).toEqual([{ type: "respond_ack", id: "x", ok: true }]);
  });
});
