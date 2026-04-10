/**
 * SQLite-backed audit log storage.
 */

import type { AuditEntry } from "./logger.js";

export class AuditStore {
  constructor(dbPath?: string) {
    // TODO: Initialize SQLite DB at dbPath or ~/.agentguard/audit.db
    // TODO: Create table if not exists
  }

  insert(entry: AuditEntry): void {
    // TODO: Insert audit entry into SQLite
  }

  query(filters: {
    agent?: string;
    since?: Date;
    decision?: string;
    limit?: number;
  }): AuditEntry[] {
    // TODO: Query with filters
    throw new Error("Not implemented");
  }

  prune(olderThanDays: number): number {
    // TODO: Delete entries older than retention period, return count deleted
    throw new Error("Not implemented");
  }
}
