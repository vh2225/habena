import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { getAuditDbPath } from "../../config/paths.js";
import type { Check, CheckResult } from "../types.js";

/**
 * Verify the audit DB can be opened, written, and the row count is retrievable.
 * We use a transaction that always rolls back, so this is non-destructive.
 *
 * Doesn't use the AuditLogger directly — we want to test the raw file, not
 * our wrapper, and we want to avoid holding the connection past this check.
 */
export const auditDbWritableCheck: Check = {
  name: "audit-db-writable",
  async run(): Promise<CheckResult> {
    const dbPath = getAuditDbPath();
    if (!existsSync(dbPath)) {
      return {
        name: "audit-db-writable",
        status: "warn",
        detail: `No audit DB at ${dbPath}`,
        fixHint: "Run `habena start` once to create it.",
      };
    }

    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath);
      // Check table exists first — a DB file can exist without the schema
      // (e.g. created then truncated, or by an older version)
      const tableRow = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_entries'").get();
      if (!tableRow) {
        return {
          name: "audit-db-writable",
          status: "warn",
          detail: `Audit DB exists but has no audit_entries table (nothing has been logged yet)`,
          fixHint: "Run a tool call through the proxy to initialize the schema, or delete the file and let `habena start` recreate it.",
        };
      }
      const { rowCount } = db.prepare("SELECT COUNT(*) as rowCount FROM audit_entries").get() as { rowCount: number };
      // Non-destructive write test: start a transaction, do a write, roll back.
      const tx = db.transaction(() => {
        db!.prepare(
          "INSERT INTO audit_entries (timestamp, agent_type, instance_id, tool, args, mcp_server, decision, tier, result_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
          new Date().toISOString(),
          "__doctor_probe__",
          "__doctor_probe__",
          "__probe__",
          "{}",
          "__probe__",
          "allow",
          "built_in",
          "success"
        );
        throw new Error("rollback");
      });
      try { tx(); } catch (err) {
        if ((err as Error).message !== "rollback") throw err;
      }
      const size = statSync(dbPath).size;
      const mb = (size / (1024 * 1024)).toFixed(1);
      return {
        name: "audit-db-writable",
        status: "pass",
        detail: `${mb} MB, ${rowCount.toLocaleString()} rows, write test ok`,
      };
    } catch (err) {
      const msg = (err as Error).message;
      let hint = "Check disk space and file permissions on ~/.habena/.";
      if (/NODE_MODULE_VERSION/.test(msg)) {
        hint = "`better-sqlite3` ABI mismatch — run `npm rebuild better-sqlite3 --build-from-source`.";
      } else if (/readonly|permission/i.test(msg)) {
        hint = "Audit DB is read-only. Check ownership and filesystem flags.";
      }
      return {
        name: "audit-db-writable",
        status: "fail",
        detail: msg,
        fixHint: hint,
      };
    } finally {
      if (db) db.close();
    }
  },
};
