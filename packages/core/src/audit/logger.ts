/**
 * Structured audit logger — every tool call gets logged.
 */

import type { AuditStore } from "./store.js";

export interface AuditEntry {
  timestamp: Date;
  agent: string;
  sessionId: string;
  tool: string;
  args: Record<string, unknown>;
  mcpServer: string;
  decision: "allow" | "deny" | "require_approval";
  ruleMatched?: string;
  tier: "built_in" | "user" | "session";
  cost: number | null;
  latencyMs: number | null;
  resultStatus: "success" | "error" | "timeout" | "pending";
}

export class AuditLogger {
  private store: AuditStore;

  constructor(dbPath?: string) {
    this.store = new AuditStore(dbPath);
  }

  log(entry: AuditEntry): void {
    this.store.insert(entry);
  }

  query(filters: {
    agent?: string;
    since?: Date;
    decision?: string;
    limit?: number;
  }): AuditEntry[] {
    return this.store.query(filters);
  }
}
