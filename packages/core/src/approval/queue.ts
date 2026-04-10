/**
 * Holds pending approval requests and resolves them
 * when a human responds via CLI, web UI, or push notification.
 */

import type { PolicyDecision, ApprovalOption } from "../policy/decisions.js";

export interface PendingApproval {
  id: string;
  decision: PolicyDecision;
  createdAt: Date;
  expiresAt: Date;
  resolve: (option: ApprovalOption) => void;
  reject: (reason: string) => void;
}

export class ApprovalQueue {
  private pending: Map<string, PendingApproval> = new Map();

  async request(decision: PolicyDecision, timeoutMs: number): Promise<ApprovalOption> {
    // TODO: Create pending approval, notify user, wait for response or timeout
    throw new Error("Not implemented");
  }

  respond(id: string, option: ApprovalOption): void {
    const approval = this.pending.get(id);
    if (!approval) throw new Error(`No pending approval with id: ${id}`);
    approval.resolve(option);
    this.pending.delete(id);
  }

  list(): PendingApproval[] {
    return Array.from(this.pending.values());
  }

  private startTimeoutCheck(): void {
    // TODO: Periodically check for expired approvals and auto-deny
  }
}
