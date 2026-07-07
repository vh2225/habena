import type { PolicyDecision } from "../policy/decisions.js";
import type { ToolCallRequest } from "../proxy/server.js";
import type { ChatChannelId } from "../chat/types.js";

/**
 * A tool-call request as seen by the approval layer: the proxy's request
 * plus the chat channel ("web" | "telegram") that originated the run, when
 * one is active. Single source of truth for the origin field — the proxy
 * builds it, ApprovalQueue.request() accepts it, PendingApproval carries it.
 */
export type ApprovalToolCallRequest = ToolCallRequest & {
  origin?: ChatChannelId;
};

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
   * `request.origin` marks which channel (web UI vs Telegram chat bridge)
   * produced the run that triggered this approval, set from
   * `chatFloor.active()` at creation time in the proxy. Undefined when no
   * chat run is active.
   */
  request: ApprovalToolCallRequest;
  createdAt: Date;
  expiresAt: Date;
}
