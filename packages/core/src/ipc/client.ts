import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/paths.js";
import {
  encode,
  decodeLines,
  type ServerMessage,
  type ClientMessage,
  type SerializedPendingApproval,
} from "./protocol.js";

const SOCKET_FILE = "agentguard.sock";

export function socketPath(): string {
  return join(getConfigDir(), SOCKET_FILE);
}

/**
 * Thin wrapper around a unix-socket connection to `habena start`'s
 * IPC server. Emits parsed ServerMessage objects via the handler, lets
 * callers send ClientMessages, and cleanly surfaces connect errors as
 * the caller's problem (instead of letting node crash on ECONNREFUSED).
 */
export class IpcClient {
  private socket: Socket | null = null;
  private buffer = "";
  private handler: ((msg: ServerMessage) => void) | null = null;
  private closedHandler: (() => void) | null = null;

  constructor(private path: string = socketPath()) {}

  async connect(): Promise<void> {
    if (!existsSync(this.path)) {
      throw new Error(
        `Socket not found: ${this.path}\n  Is Habena running? Try: habena start`
      );
    }
    this.socket = createConnection(this.path);
    return new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        this.socket?.off("connect", onConnect);
        reject(err);
      };
      const onConnect = () => {
        this.socket?.off("error", onError);
        this.wireDataHandler();
        resolve();
      };
      this.socket!.once("error", onError);
      this.socket!.once("connect", onConnect);
    });
  }

  private wireDataHandler(): void {
    if (!this.socket) return;
    this.socket.on("data", (chunk) => {
      this.buffer += chunk.toString();
      const { messages, remainder } = decodeLines(this.buffer);
      this.buffer = remainder;
      for (const raw of messages) {
        if (this.handler) this.handler(raw as ServerMessage);
      }
    });
    this.socket.on("close", () => {
      if (this.closedHandler) this.closedHandler();
    });
    this.socket.on("error", () => {
      // Soft-handle — the close event will follow.
    });
  }

  onMessage(handler: (msg: ServerMessage) => void): void {
    this.handler = handler;
  }

  onClose(handler: () => void): void {
    this.closedHandler = handler;
  }

  send(msg: ClientMessage): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.write(encode(msg));
  }

  close(): void {
    this.socket?.end();
    this.socket = null;
  }

  /** One-shot: list pending approvals, then disconnect. */
  async listPending(timeoutMs = 2000): Promise<SerializedPendingApproval[]> {
    await this.connect();
    const items = await new Promise<SerializedPendingApproval[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for pending_list")), timeoutMs);
      this.onMessage((msg) => {
        if (msg.type === "pending_list") {
          clearTimeout(timer);
          resolve(msg.pending);
        }
      });
      this.send({ type: "list_pending" });
    });
    this.close();
    return items;
  }
}
