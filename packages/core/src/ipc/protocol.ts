import type { PendingApproval, ApprovalResponse } from "../approval/types.js";
import type { AuditEntry } from "../audit/types.js";
import type { ChatEvent } from "../chat/types.js";

/** Messages sent from server (proxy) to client (watcher / Tauri UI). */
export type ServerMessage =
  | { type: "hello"; version: string }
  | { type: "approval_request"; id: string; pending: SerializedPendingApproval }
  | { type: "approval_resolved"; id: string; outcome: ApprovalResponse["choice"] }
  | { type: "respond_ack"; id: string; ok: boolean; reason?: string }
  | { type: "pending_list"; pending: SerializedPendingApproval[] }
  | { type: "lockdown_ack"; on: boolean }
  | { type: "overrides_list"; lockdown: boolean; overrides: SerializedOverride[] }
  | { type: "revoke_ack"; id: string; ok: boolean }
  | { type: "audit"; entry: AuditEntry }
  | { type: "chat_ack"; ok: boolean; reason?: string }
  | { type: "chat_event"; event: ChatEvent }
  | { type: "chat_history_result"; events: ChatEvent[] }
  | { type: "chat_status_result"; bridgeUp: boolean; running: boolean; disarmed: string[]; queueDepth: number }
  | { type: "error"; message: string };

/** Messages sent from client to server. */
export type ClientMessage =
  | { type: "respond"; id: string; choice: ApprovalResponse["choice"]; durationMs?: number; note?: string }
  | { type: "list_pending" }
  | { type: "set_lockdown"; on: boolean }
  | { type: "list_overrides" }
  | { type: "revoke_override"; id: string }
  | { type: "chat_send"; text: string }
  | { type: "chat_subscribe" }
  | { type: "chat_history"; limit?: number }
  | { type: "chat_status" }
  | { type: "chat_rearm"; channel: "web" | "telegram" };

/** An active allow_session grant, as shown to the operator. */
export interface SerializedOverride {
  id: string;
  tool: string;
  reason: string;
  expiresAt: string;
}

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
  /** Which channel's run produced this approval ("web" | "telegram"), when known. */
  origin?: string;
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
    origin: p.request.origin,
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
