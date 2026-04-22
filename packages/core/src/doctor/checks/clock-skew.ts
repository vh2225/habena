import type { Check, CheckResult } from "../types.js";

/**
 * Compare local clock to an authoritative HTTP Date header. Wildly wrong
 * timestamps in the audit log are hell to debug post-hoc; this catches
 * NTP drift early. Warning, not failure — NTP can lag a few seconds
 * during startup and that's not catastrophic.
 */
export const clockSkewCheck: Check = {
  name: "clock-skew",
  async run(): Promise<CheckResult> {
    const WARN_SEC = 5;
    const FAIL_SEC = 60;
    // google.com returns a standard Date header on every response and is
    // reliably reachable. HEAD keeps the transfer minimal.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const beforeMs = Date.now();
      const r = await fetch("https://www.google.com/generate_204", {
        method: "HEAD",
        signal: ctrl.signal,
      });
      const afterMs = Date.now();
      const serverDate = r.headers.get("date");
      if (!serverDate) {
        return {
          name: "clock-skew",
          status: "warn",
          detail: "No Date header in response; skipping skew check",
        };
      }
      const serverMs = new Date(serverDate).getTime();
      // Take the local timestamp at the midpoint of the round-trip to
      // minimise network-latency bias.
      const localMs = (beforeMs + afterMs) / 2;
      const skewSec = Math.round((localMs - serverMs) / 1000);
      const absSec = Math.abs(skewSec);
      if (absSec < WARN_SEC) {
        return {
          name: "clock-skew",
          status: "pass",
          detail: `${skewSec >= 0 ? "+" : ""}${skewSec}s vs google.com`,
        };
      }
      const sign = skewSec >= 0 ? "+" : "";
      return {
        name: "clock-skew",
        status: absSec < FAIL_SEC ? "warn" : "fail",
        detail: `Clock is ${sign}${skewSec}s vs google.com`,
        fixHint: "Enable system NTP sync (timedatectl set-ntp true on Linux, `sudo sntp -sS time.apple.com` on macOS).",
      };
    } catch (err) {
      return {
        name: "clock-skew",
        status: "warn",
        detail: `Couldn't reach google.com: ${(err as Error).message}`,
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
