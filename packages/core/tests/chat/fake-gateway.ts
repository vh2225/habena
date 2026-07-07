// packages/core/tests/chat/fake-gateway.ts
// In-process stand-in for the OpenClaw gateway WS control plane. Speaks the
// dialect recorded in fixtures/gateway-frames.json — if this file and the
// fixture disagree, THE FIXTURE IS RIGHT: update this file.
//
// Recorded dialect (fixtures/gateway-frames.json):
// - On connect the gateway pushes `{type:"event",event:"connect.challenge",payload:{nonce,ts}}`.
// - `connect` req → `{type:"res",id,ok:true,payload:{type:"hello-ok",...}}`.
// - `chat.send` params are `{sessionKey, message, idempotencyKey}` (`message`,
//   NOT `text`); the ack is `{type:"res",id,ok:true,payload:{runId,status:"started"}}`
//   — on the live gateway runId echoes the idempotencyKey.
// - The streamed reply arrives as `event:"chat"` frames discriminated by
//   `payload.state`: `"delta"` frames carry `deltaText` (the new chunk) plus a
//   cumulative `message` snapshot `{role:"assistant",content:[{type:"text",text}],timestamp}`;
//   the `"final"` frame carries `stopReason:"stop"` and the full `message`.
//   Envelope fields: `runId`, `sessionKey`, `seq` (payload-level), plus a
//   frame-level `seq`.
import { WebSocketServer, WebSocket } from "ws";

interface Scripted {
  chunks: string[];
  final: string;
}

export class FakeGateway {
  private wss?: WebSocketServer;
  private port = 0;
  private scripted: Scripted = { chunks: [], final: "" };
  readonly received: Array<Record<string, unknown>> = [];
  private readonly requireToken?: string;
  /**
   * Task 5 test hook: accept sockets and record inbound frames but never send
   * anything (no challenge, no responses) — models a gateway that accepts the
   * WS connection and then hangs, for connect-timeout regression tests.
   */
  private readonly silent: boolean;
  /**
   * Task 5 test hook: ack chat.send normally but hold the scripted streamed
   * reply until flushReply() is called, so tests can inject noise frames
   * while the run is ACTIVE (after the ack, before the final).
   */
  private readonly holdReplies: boolean;
  private heldReply?: { ws: WebSocket; runId: string; sessionKey: string };
  private eventSeq = 0;
  private readonly clients = new Set<WebSocket>();

  constructor(opts?: { requireToken?: string; silent?: boolean; holdReplies?: boolean }) {
    this.requireToken = opts?.requireToken;
    this.silent = opts?.silent ?? false;
    this.holdReplies = opts?.holdReplies ?? false;
  }

  get url(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  /** Script the reply to the next chat.send: emits deltas then a final. */
  replyWith(chunks: string[], final: string): void {
    this.scripted = { chunks, final };
  }

  /**
   * Broadcast an arbitrary raw frame to all connected clients, bypassing the
   * scripted chat.send reply. Added for Task 5 so tests can inject
   * background-noise `chat` events under an unrelated runId (mirroring the
   * `active-memory-*` / ambient events the recorded captures show
   * interleaving with the real reply) and prove the bridge filters by runId
   * rather than by event shape alone.
   */
  emitRaw(frame: Record<string, unknown>): void {
    for (const ws of this.clients) ws.send(JSON.stringify(frame));
  }

  /**
   * Release a reply held back by the `holdReplies` option: streams the
   * scripted delta/final frames for the most recent acked chat.send.
   */
  flushReply(): void {
    const held = this.heldReply;
    if (!held) throw new Error("FakeGateway.flushReply: no held reply (was holdReplies set and chat.send acked?)");
    this.heldReply = undefined;
    this.streamReply(held.ws, held.runId, held.sessionKey);
  }

  start(port?: number): Promise<number> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ host: "127.0.0.1", port: port ?? 0 }, () => {
        this.port = (this.wss!.address() as { port: number }).port;
        resolve(this.port);
      });
      this.wss.on("connection", (ws) => this.handle(ws));
    });
  }

  private handle(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on("close", () => this.clients.delete(ws));
    // fixtures/gateway-frames.json frames[0]: challenge pushed on connect.
    if (!this.silent) {
      ws.send(
        JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "n", ts: 1 },
        }),
      );
    }
    ws.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Record<string, unknown>;
      this.received.push(frame);
      if (this.silent) return;
      if (frame.type !== "req") return;
      const params = frame.params as Record<string, unknown> | undefined;

      if (frame.method === "connect") {
        const token = (params?.auth as { token?: string } | undefined)?.token;
        if (this.requireToken && token !== this.requireToken) {
          ws.send(
            JSON.stringify({
              type: "res",
              id: frame.id,
              ok: false,
              error: { code: "UNAUTHORIZED", message: "unauthorized" },
            }),
          );
          ws.close();
          return;
        }
        // Trimmed hello-ok mirroring fixtures/gateway-frames.json frames[2].
        ws.send(
          JSON.stringify({
            type: "res",
            id: frame.id,
            ok: true,
            payload: {
              type: "hello-ok",
              protocol: 4,
              server: { version: "fake", connId: "c1" },
              features: { methods: ["chat.send"], events: ["connect.challenge", "chat", "agent"] },
              snapshot: {},
              auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
              policy: { maxPayload: 1048576, maxBufferedBytes: 2097152, tickIntervalMs: 15000 },
            },
          }),
        );
        return;
      }

      if (frame.method === "chat.send") {
        const p = params as
          | { sessionKey?: string; message?: string; idempotencyKey?: string }
          | undefined;
        const sessionKey = p?.sessionKey ?? "s";
        // Live gateway echoes the idempotencyKey as the runId
        // (fixtures/gateway-frames.json: idempotencyKey f6d3b062… === ack runId).
        const runId = p?.idempotencyKey ?? `run-${++this.eventSeq}`;
        ws.send(
          JSON.stringify({
            type: "res",
            id: frame.id,
            ok: true,
            payload: { runId, status: "started" },
          }),
        );
        if (this.holdReplies) {
          this.heldReply = { ws, runId, sessionKey };
          return;
        }
        this.streamReply(ws, runId, sessionKey);
      }
    });
  }

  /**
   * Streamed reply: chat delta events with deltaText + cumulative message
   * snapshot, then the final frame with stopReason.
   */
  private streamReply(ws: WebSocket, runId: string, sessionKey: string): void {
    let cumulative = "";
    let payloadSeq = 1;
    const chatEvent = (payload: Record<string, unknown>) =>
      ws.send(
        JSON.stringify({
          type: "event",
          event: "chat",
          payload: { runId, sessionKey, seq: ++payloadSeq, ...payload },
          seq: ++this.eventSeq,
        }),
      );
    for (const deltaText of this.scripted.chunks) {
      cumulative += deltaText;
      chatEvent({
        state: "delta",
        deltaText,
        message: {
          role: "assistant",
          content: [{ type: "text", text: cumulative }],
          timestamp: 1,
        },
      });
    }
    chatEvent({
      state: "final",
      stopReason: "stop",
      message: {
        role: "assistant",
        content: [{ type: "text", text: this.scripted.final }],
        timestamp: 1,
      },
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) return resolve();
      for (const c of this.wss.clients) c.terminate();
      this.wss.close(() => resolve());
    });
  }
}
