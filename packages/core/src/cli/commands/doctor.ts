import chalk from "chalk";
import { runDoctor } from "../../doctor/runner.js";
import type { CheckResult } from "../../doctor/types.js";

interface DoctorOptions {
  only?: string;
  skip?: string;
  fix?: boolean;
  json?: boolean;
}

export async function doctorCommand(options: DoctorOptions): Promise<void> {
  const only = options.only?.split(",").map((s) => s.trim()).filter(Boolean);
  const skip = options.skip?.split(",").map((s) => s.trim()).filter(Boolean);

  const results = await runDoctor({ only, skip, fix: options.fix });
  const failures = results.filter((r) => r.status === "fail").length;

  if (options.json) {
    process.stdout.write(JSON.stringify({ results, summary: countStatuses(results) }, null, 2) + "\n");
    process.exit(failures > 0 ? 1 : 0);
  }

  printHuman(results);
  process.exit(failures > 0 ? 1 : 0);
}

function countStatuses(results: CheckResult[]): Record<string, number> {
  const c = { pass: 0, warn: 0, fail: 0 };
  for (const r of results) c[r.status]++;
  return c;
}

function printHuman(results: CheckResult[]): void {
  const when = new Date().toLocaleString("en-US", { timeZoneName: "short" });
  console.log();
  console.log(chalk.bold(`AgentGuard health report (${when})`));
  console.log("─".repeat(50));
  const maxName = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const icon =
      r.status === "pass" ? chalk.green("✓") :
      r.status === "warn" ? chalk.yellow("⚠") :
      chalk.red("✗");
    const color =
      r.status === "pass" ? chalk.gray :
      r.status === "warn" ? chalk.yellow :
      chalk.red;
    console.log(`  ${icon} ${r.name.padEnd(maxName + 2)} ${color(r.detail)}`);
    if (r.fixHint) {
      console.log(`    ${chalk.gray("└─ fix:")} ${chalk.gray(r.fixHint)}`);
    }
  }
  const c = countStatuses(results);
  console.log();
  const summary = [
    c.fail > 0 ? chalk.red(`${c.fail} failed`) : null,
    c.warn > 0 ? chalk.yellow(`${c.warn} warning${c.warn > 1 ? "s" : ""}`) : null,
    c.pass > 0 ? chalk.green(`${c.pass} passed`) : null,
  ].filter(Boolean).join(", ");
  console.log(summary);
}
