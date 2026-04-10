import type { PolicyDecision } from "../policy/decisions.js";
import type { ToolCallRequest } from "../proxy/server.js";

export type ApprovalChoice =
  | "allow_once"
  | "allow_session"
  | "deny";

export interface ApprovalResponse {
  choice: ApprovalChoice;
  /** For allow_session: duration in ms to keep the session override alive. */
  durationMs?: number;
  /** Optional free-form note from the user (shown in audit log). */
  note?: string;
}

export interface PendingApproval {
  id: string;
  decision: PolicyDecision;
  request: ToolCallRequest;
  createdAt: Date;
  expiresAt: Date;
}
