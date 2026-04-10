/**
 * Shadow/observe mode — logs all tool calls without enforcing policies.
 * Used to learn an agent's behavior before generating a least-privilege policy.
 */

import type { AuditLogger, AuditEntry } from "../audit/logger.js";

export class Observer {
  private logger: AuditLogger;
  private agentName: string;
  private startedAt: Date;

  constructor(logger: AuditLogger, agentName: string) {
    this.logger = logger;
    this.agentName = agentName;
    this.startedAt = new Date();
  }

  record(entry: Omit<AuditEntry, "decision" | "ruleMatched" | "tier">): void {
    this.logger.log({
      ...entry,
      decision: "allow",
      ruleMatched: "learning_mode",
      tier: "built_in",
    });
  }

  getObservationPeriod(): { start: Date; end: Date } {
    return { start: this.startedAt, end: new Date() };
  }
}
