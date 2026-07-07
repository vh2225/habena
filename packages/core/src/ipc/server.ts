import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { existsSync, unlinkSync, chmodSync } from "node:fs";
import type { ApprovalQueue } from "../approval/queue.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { PendingApproval, ApprovalResponse } from "../approval/types.js";
import type { ChatChannelManager } from "../chat/manager.js";
import {
  encode,
  decodeLines,
  serializePending,
  type ClientMessage,
  type ServerMessage,
} from "./protocol.js";

export class IpcServer {
  private server: Server | null = null;
  private clients: Set<Socket> = new Set();
  /** Per-connection chat_subscribe unsubscribe, so close cleanup can undo it. */
  private chatUnsubscribes = new Map<Socket, () => void>();

  private onApprovalRequest = (pending: PendingApproval): void => {
    this.broadcast({
      type: "approval_request",
      id: pending.id,
      pending: serializePending(pending),
    });
  };

  private onApprovalResolved = (pending: PendingApproval, response: ApprovalResponse): void => {
    this.broadcast({
      type: "approval_resolved",
      id: pending.id,
      outcome: response.choice,
    });
  };

  constructor(
    private queue: ApprovalQueue,
    private socketPath: string,
    /** When present, lockdown + session-override operator commands work. */
    private policy?: PolicyEngine,
    /** When present, the chat_* frames are wired to the chat channel manager. */
    private chat?: ChatChannelManager
  ) {}

  async start(): Promise<void> {
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch (err) {
        throw new Error(`Failed to remove stale socket ${this.socketPath}: ${(err as Error).message}`);
      }
    }

    this.server = createServer((socket) => this.handleConnection(socket));

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.socketPath, () => {
        this.server!.off("error", reject);
        try {
          chmodSync(this.socketPath, 0o600);
        } catch {
          // best-effort
        }
        resolve();
      });
    });

    this.queue.on("approval_request", this.onApprovalRequest);
    this.queue.on("approval_resolved", this.onApprovalResolved);
  }

  async stop(): Promise<void> {
    this.queue.off("approval_request", this.onApprovalRequest);
    this.queue.off("approval_resolved", this.onApprovalResolved);

    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();
    for (const unsubscribe of this.chatUnsubscribes.values()) {
      unsubscribe();
    }
    this.chatUnsubscribes.clear();

    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }

    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        // best-effort
      }
    }
  }

  private handleConnection(socket: Socket): void {
    this.clients.add(socket);

    // Send hello immediately
    socket.write(encode({ type: "hello", version: "0.1.0" }));

    // Send any currently pending approvals so a reconnecting client catches up
    for (const pending of this.queue.list()) {
      socket.write(encode({
        type: "approval_request",
        id: pending.id,
        pending: serializePending(pending),
      }));
    }

    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const { messages, remainder } = decodeLines(buffer);
      buffer = remainder;
      for (const msg of messages) {
        this.handleClientMessage(socket, msg as ClientMessage);
      }
    });

    const cleanup = () => {
      this.clients.delete(socket);
      const unsubscribe = this.chatUnsubscribes.get(socket);
      if (unsubscribe) {
        unsubscribe();
        this.chatUnsubscribes.delete(socket);
      }
    };

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  }

  private handleClientMessage(socket: Socket, msg: ClientMessage): void {
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;

    if (msg.type === "respond") {
      // Check that the id exists *before* we respond, so we can tell the
      // originating client whether the call actually resolved something.
      const pending = this.queue.list().find((p) => p.id === msg.id);
      if (!pending) {
        socket.write(encode({
          type: "respond_ack",
          id: msg.id,
          ok: false,
          reason: "unknown approval id (already resolved, expired, or never existed)",
        }));
        return;
      }
      this.queue.respond(msg.id, {
        choice: msg.choice,
        durationMs: msg.durationMs,
        note: msg.note,
      });
      socket.write(encode({
        type: "respond_ack",
        id: msg.id,
        ok: true,
      }));
    } else if (msg.type === "list_pending") {
      socket.write(encode({
        type: "pending_list",
        pending: this.queue.list().map(serializePending),
      }));
    } else if (msg.type === "set_lockdown") {
      if (!this.policy) {
        socket.write(encode({ type: "error", message: "lockdown unavailable: no policy engine attached" }));
        return;
      }
      this.policy.setLockdown(Boolean(msg.on));
      socket.write(encode({ type: "lockdown_ack", on: this.policy.isLockdown() }));
    } else if (msg.type === "list_overrides") {
      if (!this.policy) {
        socket.write(encode({ type: "error", message: "overrides unavailable: no policy engine attached" }));
        return;
      }
      socket.write(encode({
        type: "overrides_list",
        lockdown: this.policy.isLockdown(),
        overrides: this.policy.listSessionOverrides().map((o) => ({
          id: o.id,
          tool: o.tool,
          reason: o.reason,
          expiresAt: o.expiresAt.toISOString(),
        })),
      }));
    } else if (msg.type === "revoke_override") {
      if (!this.policy) {
        socket.write(encode({ type: "error", message: "overrides unavailable: no policy engine attached" }));
        return;
      }
      socket.write(encode({
        type: "revoke_ack",
        id: msg.id,
        ok: this.policy.revokeSessionOverride(msg.id),
      }));
    } else if (
      msg.type === "chat_send" ||
      msg.type === "chat_subscribe" ||
      msg.type === "chat_history" ||
      msg.type === "chat_status" ||
      msg.type === "chat_rearm"
    ) {
      this.handleChatMessage(socket, msg);
    }
  }

  private handleChatMessage(
    socket: Socket,
    msg: Extract<ClientMessage, { type: "chat_send" | "chat_subscribe" | "chat_history" | "chat_status" | "chat_rearm" }>
  ): void {
    if (!this.chat) {
      socket.write(encode({ type: "error", message: "chat disabled" }));
      return;
    }
    const chat = this.chat;

    if (msg.type === "chat_send") {
      const result = chat.handleInbound({ channel: "web", sender: "local", text: msg.text });
      socket.write(encode({ type: "chat_ack", ok: result.accepted, reason: result.reason }));
    } else if (msg.type === "chat_subscribe") {
      // A reconnect-without-disconnect (or duplicate subscribe) must not leak
      // a second subscription for the same socket.
      this.chatUnsubscribes.get(socket)?.();
      const unsubscribe = chat.subscribe((event) => {
        socket.write(encode({ type: "chat_event", event }));
      });
      this.chatUnsubscribes.set(socket, unsubscribe);
    } else if (msg.type === "chat_history") {
      socket.write(encode({ type: "chat_history_result", events: chat.history(msg.limit) }));
    } else if (msg.type === "chat_status") {
      const status = chat.status();
      socket.write(encode({
        type: "chat_status_result",
        bridgeUp: status.bridgeUp,
        running: status.running,
        disarmed: status.disarmed,
        queueDepth: status.queueDepth,
      }));
    } else if (msg.type === "chat_rearm") {
      chat.rearm(msg.channel);
      socket.write(encode({ type: "chat_ack", ok: true }));
    }
  }

  private broadcast(msg: ServerMessage): void {
    const line = encode(msg);
    for (const client of this.clients) {
      try {
        client.write(line);
      } catch {
        // client may be disconnecting; drop
      }
    }
  }
}
