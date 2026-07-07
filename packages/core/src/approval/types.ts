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
  /**
   * `origin` marks which channel (web UI vs Telegram chat bridge) produced
   * the run that triggered this approval, set from `chatFloor.active()` at
   * creation time in the proxy. Undefined when no chat run is active.
   */
  request: ToolCallRequest & { origin?: "web" | "telegram" };
  createdAt: Date;
  expiresAt: Date;
}
