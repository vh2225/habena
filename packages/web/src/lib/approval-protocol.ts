// Minimal mirror of packages/core/src/ipc/protocol.ts — web can't import core.
// Keep field names/shapes byte-identical to the core protocol.

export type ApprovalChoice = "allow_once" | "allow_session" | "deny";

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

export interface SerializedOverride {
  id: string;
  tool: string;
  reason: string;
  expiresAt: string;
}

/**
 * Mirror of packages/core/src/chat/types.ts ChatEvent — web can't import core.
 * Keep kinds/fields byte-identical to the core union.
 */
export type ChatChannelId = "web" | "telegram";

export type ChatEventWire =
  | { kind: "user"; channel: ChatChannelId; text: string; at: string }
  | { kind: "assistant_delta"; text: string; at: string }
  | { kind: "assistant_final"; text: string; at: string }
  | { kind: "status"; state: "idle" | "running" | "offline" | "disarmed"; channel?: ChatChannelId; detail?: string; at: string }
  | { kind: "rejected"; channel: ChatChannelId; reason: string; at: string };

export type ServerMessage =
  | { type: "hello"; version: string }
  | { type: "approval_request"; id: string; pending: SerializedPendingApproval }
  | { type: "approval_resolved"; id: string; outcome: ApprovalChoice }
  | { type: "respond_ack"; id: string; ok: boolean; reason?: string }
  | { type: "pending_list"; pending: SerializedPendingApproval[] }
  | { type: "lockdown_ack"; on: boolean }
  | { type: "overrides_list"; lockdown: boolean; overrides: SerializedOverride[] }
  | { type: "revoke_ack"; id: string; ok: boolean }
  | { type: "chat_ack"; ok: boolean; reason?: string }
  | { type: "chat_event"; event: ChatEventWire }
  | { type: "chat_history_result"; events: ChatEventWire[] }
  | { type: "chat_status_result"; bridgeUp: boolean; running: boolean; disarmed: string[]; queueDepth: number }
  | { type: "error"; message: string };

export type ClientMessage =
  | { type: "respond"; id: string; choice: ApprovalChoice; durationMs?: number; note?: string }
  | { type: "list_pending" }
  | { type: "set_lockdown"; on: boolean }
  | { type: "list_overrides" }
  | { type: "revoke_override"; id: string }
  | { type: "chat_send"; text: string }
  | { type: "chat_subscribe" }
  | { type: "chat_history"; limit?: number }
  | { type: "chat_status" }
  | { type: "chat_rearm"; channel: "web" | "telegram" };

export function encode(msg: ClientMessage | ServerMessage): string {
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
      /* skip malformed */
    }
  }
  return { messages, remainder };
}
