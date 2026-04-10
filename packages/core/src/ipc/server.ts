import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { existsSync, unlinkSync, chmodSync } from "node:fs";
import type { ApprovalQueue } from "../approval/queue.js";
import type { PendingApproval, ApprovalResponse } from "../approval/types.js";
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

  constructor(private queue: ApprovalQueue, private socketPath: string) {}

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

    socket.on("close", () => {
      this.clients.delete(socket);
    });

    socket.on("error", () => {
      this.clients.delete(socket);
    });
  }

  private handleClientMessage(socket: Socket, msg: ClientMessage): void {
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;

    if (msg.type === "respond") {
      this.queue.respond(msg.id, {
        choice: msg.choice,
        durationMs: msg.durationMs,
        note: msg.note,
      });
    } else if (msg.type === "list_pending") {
      socket.write(encode({
        type: "pending_list",
        pending: this.queue.list().map(serializePending),
      }));
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
