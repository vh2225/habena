import { execSync } from "node:child_process";
import type { Check, CheckResult } from "../types.js";

/**
 * Verify Node >= 20 and that native deps load without ABI mismatch.
 * We specifically test better-sqlite3 since it's the only native dep
 * in the core package and it's what blows up when Node major-upgrades.
 */
export const nodeVersionCheck: Check = {
  name: "node-version",
  async run(): Promise<CheckResult> {
    const major = parseInt(process.versions.node.split(".")[0], 10);
    if (isNaN(major) || major < 20) {
      return {
        name: "node-version",
        status: "fail",
        detail: `Node v${process.versions.node}, minimum v20 required`,
        fixHint: "Upgrade Node (nvm install 20 or brew install node@20).",
      };
    }

    try {
      const mod = await import("better-sqlite3");
      // Instantiating a memory DB proves the native binding loads.
      const db = new mod.default(":memory:");
      db.close();
      return {
        name: "node-version",
        status: "pass",
        detail: `Node v${process.versions.node}, better-sqlite3 loads cleanly`,
      };
    } catch (err) {
      const msg = (err as Error).message;
      const isAbiMismatch = /NODE_MODULE_VERSION/.test(msg);
      return {
        name: "node-version",
        status: "fail",
        detail: isAbiMismatch ? "better-sqlite3 ABI mismatch" : msg,
        fixHint: "npm rebuild better-sqlite3 --build-from-source",
        autoFixable: isAbiMismatch,
      };
    }
  },
  async autoFix(): Promise<CheckResult> {
    try {
      execSync("npm rebuild better-sqlite3 --build-from-source", {
        cwd: new URL("../../../", import.meta.url).pathname,
        stdio: "pipe",
      });
      // Re-run the check to confirm
      return await nodeVersionCheck.run();
    } catch (err) {
      return {
        name: "node-version",
        status: "fail",
        detail: `Auto-fix failed: ${(err as Error).message}`,
        fixHint: "Run `npm rebuild better-sqlite3 --build-from-source` manually in the agentguard core package dir.",
      };
    }
  },
};
