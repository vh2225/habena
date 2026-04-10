import type { PendingApproval, ApprovalResponse } from "../approval/types.js";
import type { AuditEntry } from "../audit/types.js";

/** Messages sent from server (proxy) to client (watcher / Tauri UI). */
export type ServerMessage =
  | { type: "hello"; version: string }
  | { type: "approval_request"; id: string; pending: SerializedPendingApproval }
  | { type: "approval_resolved"; id: string; outcome: ApprovalResponse["choice"] }
  | { type: "pending_list"; pending: SerializedPendingApproval[] }
  | { type: "audit"; entry: AuditEntry }
  | { type: "error"; message: string };

/** Messages sent from client to server. */
export type ClientMessage =
  | { type: "respond"; id: string; choice: ApprovalResponse["choice"]; durationMs?: number; note?: string }
  | { type: "list_pending" };

export interface SerializedPendingApproval {
  id: string;
  agentType: string;
  instanceId: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  estimatedCost: number;
  createdAt: string;
  expiresAt: string;
}

export function serializePending(p: PendingApproval): SerializedPendingApproval {
  return {
    id: p.id,
    agentType: p.request.agentType,
    instanceId: p.request.instanceId,
    tool: p.request.tool,
    args: p.request.args,
    reason: p.decision.reason,
    estimatedCost: p.request.estimatedCost,
    createdAt: p.createdAt.toISOString(),
    expiresAt: p.expiresAt.toISOString(),
  };
}

export function encode(msg: ServerMessage | ClientMessage): string {
  return JSON.stringify(msg) + "\n";
}

export function decodeLines(buffer: string): { messages: unknown[]; remainder: string } {
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";
  const messages: unknown[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return { messages, remainder };
}
