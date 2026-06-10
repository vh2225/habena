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

export type ServerMessage =
  | { type: "hello"; version: string }
  | { type: "approval_request"; id: string; pending: SerializedPendingApproval }
  | { type: "approval_resolved"; id: string; outcome: ApprovalChoice }
  | { type: "respond_ack"; id: string; ok: boolean; reason?: string }
  | { type: "pending_list"; pending: SerializedPendingApproval[] }
  | { type: "lockdown_ack"; on: boolean }
  | { type: "overrides_list"; lockdown: boolean; overrides: SerializedOverride[] }
  | { type: "revoke_ack"; id: string; ok: boolean }
  | { type: "error"; message: string };

export type ClientMessage =
  | { type: "respond"; id: string; choice: ApprovalChoice; durationMs?: number; note?: string }
  | { type: "list_pending" }
  | { type: "set_lockdown"; on: boolean }
  | { type: "list_overrides" }
  | { type: "revoke_override"; id: string };

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
