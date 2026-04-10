import { AuditStore } from "./store.js";
import type { AuditEntry, AuditQueryFilters } from "./types.js";

export class AuditLogger {
  private store: AuditStore;

  constructor(dbPath: string) {
    this.store = new AuditStore(dbPath);
  }

  log(entry: AuditEntry): void {
    this.store.insert(entry);
  }

  query(filters: AuditQueryFilters): AuditEntry[] {
    return this.store.query(filters);
  }

  prune(retentionDays: number): number {
    return this.store.prune(retentionDays);
  }

  close(): void {
    this.store.close();
  }
}
