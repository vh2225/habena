import { describe, it, expect } from "vitest";
import { PassThrough, type Duplex } from "node:stream";
import { listPending, respond } from "./approval-ipc";
import { encode, decodeLines, type SerializedPendingApproval } from "./approval-protocol";

// A fake "proxy" that pipes client→server→client over two PassThroughs,
// mimicking IpcServer's behavior for the two messages we use.
function fakeProxy(pending: SerializedPendingApproval[]): () => Duplex {
  return () => {
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    // On connect, the real server sends hello — assert the client ignores it.
    toClient.write(encode({ type: "hello", version: "test" }));
    let buf = "";
    toServer.on("data", (chunk) => {
      buf += chunk.toString();
      const { messages, remainder } = decodeLines(buf);
      buf = remainder;
      for (const m of messages as any[]) {
        if (m.type === "list_pending") {
          toClient.write(encode({ type: "pending_list", pending }));
        } else if (m.type === "respond") {
          const known = pending.some((p) => p.id === m.id);
          toClient.write(
            encode(known
              ? { type: "respond_ack", id: m.id, ok: true }
              : { type: "respond_ack", id: m.id, ok: false, reason: "unknown approval id" })
          );
        }
      }
    });
    // The Duplex the client uses: writes go to server, reads come from client-bound stream.
    // NOTE: we wrap (not mutate) toClient so the fixture's own toClient.write(...) responses
    // above still flow to the client — overriding toClient.write in place would redirect the
    // server's replies back into the server stream and the client would never see them.
    const conn = Object.create(toClient) as PassThrough;
    conn.write = toServer.write.bind(toServer) as PassThrough["write"];
    conn.end = (() => { toServer.end(); toClient.end(); return conn; }) as PassThrough["end"];
    return conn as unknown as Duplex;
  };
}

const SAMPLE: SerializedPendingApproval = {
  id: "abc", agentType: "openclaw", instanceId: "inst-1", tool: "fs.write",
  args: { path: "/etc/hosts" }, reason: "write requires approval", estimatedCost: 0,
  createdAt: "2026-06-09T00:00:00.000Z", expiresAt: "2026-06-09T00:00:30.000Z",
};

describe("approval-ipc", () => {
  it("listPending returns the server's pending_list and ignores hello", async () => {
    const got = await listPending({ connect: fakeProxy([SAMPLE]) });
    expect(got).toEqual([SAMPLE]);
  });

  it("listPending returns [] when nothing is pending", async () => {
    expect(await listPending({ connect: fakeProxy([]) })).toEqual([]);
  });

  it("respond returns ok for a known id", async () => {
    const r = await respond("abc", "deny", { connect: fakeProxy([SAMPLE]) });
    expect(r).toEqual({ ok: true });
  });

  it("respond returns ok:false + reason for an unknown id", async () => {
    const r = await respond("nope", "allow_once", { connect: fakeProxy([SAMPLE]) });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unknown approval id/);
  });

  it("rejects on timeout when the server never answers", async () => {
    const silent = () => new PassThrough() as unknown as Duplex;
    await expect(listPending({ connect: silent, timeoutMs: 50 })).rejects.toThrow(/timed out/i);
  });
});
