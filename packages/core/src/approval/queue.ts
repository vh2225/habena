import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { PolicyDecision } from "../policy/decisions.js";
import type { ToolCallRequest } from "../proxy/server.js";
import type { PendingApproval, ApprovalResponse } from "./types.js";

interface QueuedApproval {
  pending: PendingApproval;
  resolve: (response: ApprovalResponse) => void;
  timeoutHandle: NodeJS.Timeout;
}

export interface ApprovalQueueOptions {
  /** What to do when an approval times out. Default: "deny". */
  timeoutAction?: "allow" | "deny";
}

/**
 * Holds pending approval requests in memory.
 * Emits events so IPC layers can forward requests to humans.
 *
 * Events:
 *  - "approval_request" (pending: PendingApproval)
 *  - "approval_resolved" (pending: PendingApproval, response: ApprovalResponse)
 *  - "approval_timeout" (pending: PendingApproval)
 */
export class ApprovalQueue extends EventEmitter {
  private queue: Map<string, QueuedApproval> = new Map();
  private timeoutAction: "allow" | "deny";

  constructor(options: ApprovalQueueOptions = {}) {
    super();
    this.timeoutAction = options.timeoutAction ?? "deny";
  }

  request(
    decision: PolicyDecision,
    request: ToolCallRequest,
    timeoutMs: number
  ): Promise<ApprovalResponse> {
    const id = randomUUID();
    const now = new Date();
    const pending: PendingApproval = {
      id,
      decision,
      request,
      createdAt: now,
      expiresAt: new Date(now.getTime() + timeoutMs),
    };

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        const entry = this.queue.get(id);
        if (!entry) return;
        this.queue.delete(id);
        const response: ApprovalResponse = {
          choice: this.timeoutAction === "allow" ? "allow_once" : "deny",
          note: "auto-resolved on timeout",
        };
        this.emit("approval_timeout", pending);
        this.emit("approval_resolved", pending, response);
        entry.resolve(response);
      }, timeoutMs);

      this.queue.set(id, {
        pending,
        resolve,
        timeoutHandle,
      });

      this.emit("approval_request", pending);
    });
  }

  respond(id: string, response: ApprovalResponse): void {
    const entry = this.queue.get(id);
    if (!entry) return;
    clearTimeout(entry.timeoutHandle);
    this.queue.delete(id);
    this.emit("approval_resolved", entry.pending, response);
    entry.resolve(response);
  }

  list(): PendingApproval[] {
    return Array.from(this.queue.values()).map((q) => q.pending);
  }

  cancel(id: string): void {
    const entry = this.queue.get(id);
    if (!entry) return;
    clearTimeout(entry.timeoutHandle);
    this.queue.delete(id);
  }

  shutdown(): void {
    for (const entry of this.queue.values()) {
      clearTimeout(entry.timeoutHandle);
    }
    this.queue.clear();
    this.removeAllListeners();
  }
}
