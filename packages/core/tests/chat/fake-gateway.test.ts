// packages/core/tests/chat/fake-gateway.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { FakeGateway } from "./fake-gateway.js";

const collect = (ws: WebSocket) => {
  const frames: any[] = [];
  ws.on("message", (d) => frames.push(JSON.parse(d.toString())));
  return frames;
};
const until = async (pred: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

let gw: FakeGateway;
afterEach(async () => {
  await gw?.stop();
});

describe("FakeGateway", () => {
  it("challenges, accepts a valid connect, acks chat.send with a runId, and streams chat delta/final events", async () => {
    gw = new FakeGateway({ requireToken: "tok" });
    await gw.start();
    gw.replyWith(["Hel", "lo"], "Hello");

    const ws = new WebSocket(gw.url);
    const frames = collect(ws);

    await until(() => frames.some((f) => f.event === "connect.challenge"));

    ws.send(
      JSON.stringify({
        type: "req",
        id: "1",
        method: "connect",
        params: { role: "operator", auth: { token: "tok" }, client: { id: "t" } },
      }),
    );
    await until(() => frames.some((f) => f.type === "res" && f.payload?.type === "hello-ok"));

    // Real dialect: chat.send's message field is `message`, not `text`
    // (fixtures/gateway-frames.json line ~669: params.message).
    ws.send(
      JSON.stringify({
        type: "req",
        id: "2",
        method: "chat.send",
        params: { sessionKey: "s", message: "hi", idempotencyKey: "k1" },
      }),
    );

    const chatEvents = () => frames.filter((f) => f.type === "event" && f.event === "chat");
    await until(() => chatEvents().length >= 3);

    // Real dialect: the chat.send ack payload is { runId, status: "started" }
    // (fixtures/gateway-frames.json line ~1002), not an empty payload.
    const ack = frames.find((f) => f.type === "res" && f.id === "2");
    expect(ack?.ok).toBe(true);
    expect(ack?.payload?.runId).toBe("k1");
    expect(ack?.payload?.status).toBe("started");

    // Real dialect: streamed reply is `event: "chat"` frames discriminated by
    // payload.state ("delta" | "final"), carrying `deltaText` for the
    // increment and cumulative `message.content[0].text`
    // (fixtures/gateway-frames.json lines ~1879-2035), not `event: "chat.update"`.
    const [d1, d2, fin] = chatEvents();
    expect(d1.payload.state).toBe("delta");
    expect(d1.payload.deltaText).toBe("Hel");
    expect(d1.payload.runId).toBe("k1");
    expect(d1.payload.message.content[0].text).toBe("Hel");

    expect(d2.payload.state).toBe("delta");
    expect(d2.payload.deltaText).toBe("lo");
    expect(d2.payload.message.content[0].text).toBe("Hello");

    expect(fin.payload.state).toBe("final");
    expect(fin.payload.stopReason).toBe("stop");
    expect(fin.payload.message.content[0].text).toBe("Hello");
    expect(fin.payload.runId).toBe("k1");

    expect(gw.received.some((r) => r.method === "chat.send")).toBe(true);
    ws.close();
  });

  it("rejects a bad token with res ok:false and closes the connection", async () => {
    gw = new FakeGateway({ requireToken: "tok" });
    await gw.start();

    const ws = new WebSocket(gw.url);
    const frames = collect(ws);

    await until(() => frames.some((f) => f.event === "connect.challenge"));
    ws.send(
      JSON.stringify({
        type: "req",
        id: "1",
        method: "connect",
        params: { role: "operator", auth: { token: "WRONG" }, client: { id: "t" } },
      }),
    );

    await until(() => frames.some((f) => f.type === "res" && f.ok === false));
    const rej = frames.find((f) => f.type === "res" && f.ok === false);
    expect(rej?.id).toBe("1");

    await until(() => ws.readyState === WebSocket.CLOSED, 2000);
  });
});
