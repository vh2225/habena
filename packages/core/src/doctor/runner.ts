import type { Check, CheckResult } from "./types.js";
import { proxyReachableCheck } from "./checks/proxy-reachable.js";
import { auditDbWritableCheck } from "./checks/audit-db-writable.js";
import { downstreamReachableCheck } from "./checks/downstream-reachable.js";
import { openclawPointedAtUsCheck } from "./checks/openclaw-pointed-at-us.js";
import { nodeVersionCheck } from "./checks/node-version.js";
import { clockSkewCheck } from "./checks/clock-skew.js";
import { approvalQueueDrainingCheck } from "./checks/approval-queue-draining.js";

export const ALL_CHECKS: Check[] = [
  proxyReachableCheck,
  auditDbWritableCheck,
  downstreamReachableCheck,
  approvalQueueDrainingCheck,
  openclawPointedAtUsCheck,
  nodeVersionCheck,
  clockSkewCheck,
];

export interface RunOptions {
  /** Only run checks whose name is in this list. */
  only?: string[];
  /** Skip checks whose name is in this list. */
  skip?: string[];
  /** Attempt autoFix on any failing check that advertises `autoFixable`. */
  fix?: boolean;
}

export async function runDoctor(options: RunOptions = {}): Promise<CheckResult[]> {
  const selected = ALL_CHECKS.filter((c) => {
    if (options.only && options.only.length > 0) return options.only.includes(c.name);
    if (options.skip && options.skip.includes(c.name)) return false;
    return true;
  });

  const results: CheckResult[] = [];
  for (const check of selected) {
    let result: CheckResult;
    try {
      result = await check.run();
    } catch (err) {
      result = {
        name: check.name,
        status: "fail",
        detail: `Check threw: ${(err as Error).message}`,
      };
    }
    if (options.fix && result.status === "fail" && result.autoFixable && check.autoFix) {
      try {
        result = await check.autoFix();
      } catch (err) {
        result = {
          ...result,
          detail: `${result.detail}; auto-fix failed: ${(err as Error).message}`,
        };
      }
    }
    results.push(result);
  }
  return results;
}
