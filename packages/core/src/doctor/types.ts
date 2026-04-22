export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  /** Short identifier, e.g. "proxy-reachable". */
  name: string;
  status: CheckStatus;
  /** One-line explanation of what was found. */
  detail: string;
  /** Actionable fix, only when status !== "pass". */
  fixHint?: string;
  /** When true, the CLI may run the auto-fix on `--fix`. */
  autoFixable?: boolean;
}

export interface Check {
  name: string;
  run(): Promise<CheckResult>;
  /** Optional: runs when `--fix` is passed AND run() returned autoFixable. */
  autoFix?(): Promise<CheckResult>;
}
