// packages/core/src/chat/openclaw-bridge.ts
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { AgentBridge, BridgeEvent } from "./types.js";

export interface OpenClawBridgeOptions {
  url: string;
  token?: string;
  sessionKey: string;
  /** Reconnect backoff schedule in ms. Injectable for tests. Default [1000, 2000, 5000, 10000, 30000]. */
  backoffMs?: number[];
}

const DEFAULT_BACKOFF = [1000, 2000, 5000, 10000, 30000];

/**
 * WS client to the OpenClaw gateway, speaking the dialect recorded in
 * tests/chat/fixtures/gateway-frames.json (see tests/chat/fixtures/README.md).
 * One session, one run at a time (the manager serializes; v1 is single-agent
 * per the plan's Global Constraints).
 *
 * Connect identity: the recorded fixture shows `client.id`/`client.mode` are
 * validated against closed enums on the real gateway, and the only identity
 * that both passes connect AND keeps its requested scopes (without a device
 * signature block) on loopback is the same-process backend carve-out
 * `{ id: "gateway-client", mode: "backend" }`. Every other identity (e.g.
 * `openclaw-probe`/`probe`, see fixtures/gateway-frames-scope-fail.json)
 * connects fine but comes back with `hello-ok.auth.scopes: []`, after which
 * every scoped RPC (including chat.send) fails — so this is a correctness
 * requirement, not a style choice.
 *
 * SECURITY: opts.token must never reach an emitted event, thrown error, or
 * log line (mirrors the discipline in src/approval/channels/telegram.ts).
 */
export class OpenClawBridge implements AgentBridge {
  readonly kind = "openclaw";
  private ws?: WebSocket;
  private up = false;
  private stopped = false;
  private attempt = 0;
  private listeners = new Set<(ev: BridgeEvent) => void>();
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private connectReqId?: string;
  private pendingSendReqId?: string;
  private activeRunId?: string;

  constructor(private readonly opts: OpenClawBridgeOptions) {}

  isUp(): boolean {
    return this.up;
  }

  onEvent(cb: (ev: BridgeEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(ev: BridgeEvent): void {
    for (const cb of this.listeners) cb(ev);
  }

  start(): Promise<void> {
    this.stopped = false;
    return this.connect(/* initial */ true);
  }

  private connect(initial: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url);
      this.ws = ws;
      let settled = false;

      ws.on("message", (data) => {
        let frame: any;
        try {
          frame = JSON.parse(data.toString());
        } catch {
          return;
        }

        if (frame.type === "event" && frame.event === "connect.challenge") {
          const connectId = randomUUID();
          this.connectReqId = connectId;
          ws.send(
            JSON.stringify({
              type: "req",
              id: connectId,
              method: "connect",
              params: {
                minProtocol: 3,
                maxProtocol: 4,
                // Loopback backend carve-out — see class doc comment above
                // and tests/chat/fixtures/README.md "Connect identity".
                client: {
                  id: "gateway-client",
                  version: "0.1.0",
                  platform: process.platform,
                  mode: "backend",
                },
                role: "operator",
                scopes: ["operator.read", "operator.write"],
                caps: [],
                commands: [],
                permissions: {},
                auth: this.opts.token ? { token: this.opts.token } : undefined,
                locale: "en-US",
                userAgent: "habena-chat-bridge/0.1.0",
              },
            }),
          );
          return;
        }

        if (frame.type === "res" && frame.id === this.connectReqId) {
          if (frame.ok === false) {
            // Auth/handshake rejection: config problem — do not retry-loop.
            this.stopped = true;
            const detail = frame.error?.message ?? "unauthorized";
            if (!settled) {
              settled = true;
              reject(new Error(`gateway rejected connect: ${detail}`));
            }
            return;
          }
          if (frame.payload?.type === "hello-ok") {
            this.up = true;
            this.attempt = 0;
            if (!settled) {
              settled = true;
              resolve();
            }
            this.emit({ kind: "connection", state: "up" });
          }
          return;
        }

        if (frame.type === "res" && frame.id === this.pendingSendReqId) {
          this.pendingSendReqId = undefined;
          if (frame.ok === false) {
            this.emit({ kind: "run_state", state: "error", detail: frame.error?.message ?? "chat.send rejected" });
            return;
          }
          this.activeRunId = frame.payload?.runId;
          return;
        }

        if (frame.type === "event" && frame.event === "chat") {
          const payload = frame.payload ?? {};
          // Filter by runId: the socket is a broadcast bus (background jobs,
          // ambient health/tick/presence events, other sessions' runs all
          // share it — see fixtures/README.md "Filter by runId"). Only
          // translate events belonging to our active run.
          if (!this.activeRunId || payload.runId !== this.activeRunId) return;
          switch (payload.state) {
            case "delta":
              this.emit({ kind: "delta", text: payload.deltaText ?? "" });
              break;
            case "final":
              this.emit({ kind: "final", text: payload.message?.content?.[0]?.text ?? "" });
              this.emit({ kind: "run_state", state: "finished" });
              break;
            case "error":
            case "aborted":
              this.emit({
                kind: "run_state",
                state: "error",
                detail: payload.errorMessage ?? payload.stopReason ?? payload.state,
              });
              break;
          }
        }
      });

      const onDown = () => {
        const wasUp = this.up;
        this.up = false;
        if (wasUp) this.emit({ kind: "connection", state: "down" });
        if (!settled) {
          settled = true;
          if (initial) reject(new Error("gateway connection failed"));
          else resolve(); // background retries resolve silently
        }
        this.scheduleReconnect();
      };
      ws.on("close", onDown);
      ws.on("error", () => {
        /* close follows; handled there */
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const backoff = this.opts.backoffMs ?? DEFAULT_BACKOFF;
    const delay = backoff[Math.min(this.attempt, backoff.length - 1)];
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      void this.connect(false).catch(() => {
        /* scheduleReconnect already queued by onDown */
      });
    }, delay);
  }

  async send(text: string): Promise<void> {
    if (!this.up || !this.ws) throw new Error("bridge is offline");
    this.emit({ kind: "run_state", state: "started" });
    const sendId = randomUUID();
    this.pendingSendReqId = sendId;
    this.ws.send(
      JSON.stringify({
        type: "req",
        id: sendId,
        method: "chat.send",
        params: { sessionKey: this.opts.sessionKey, message: text, idempotencyKey: randomUUID() },
      }),
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.up = false;
    this.ws?.terminate();
  }
}
