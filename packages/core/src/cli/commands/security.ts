import chalk from "chalk";
import { getConfigPath } from "../../config/paths.js";
import { loadConfigWithPacks, loadHostPolicy } from "../../config/loader.js";
import { auditPolicy, type AuditFinding } from "../../policy/audit.js";

interface AuditOptions {
  json?: boolean;
}

/**
 * `agentguard security audit` — static analysis over the resolved
 * policy. Partner to `agentguard doctor` — doctor covers runtime
 * health, this covers policy shape. Exit code equals the number of
 * error-severity findings so CI can gate on it (warnings don't fail).
 */
export async function securityAuditCommand(options: AuditOptions): Promise<void> {
  const { config, missingPacks } = loadConfigWithPacks(getConfigPath());
  const host = loadHostPolicy();

  const findings = auditPolicy({ config, hostRules: host.rules });

  if (options.json) {
    process.stdout.write(
      JSON.stringify(
        {
          configPath: getConfigPath(),
          hostPolicyPath: host.exists ? host.path : null,
          missingPacks,
          missingHostPacks: host.missingPacks,
          findings,
        },
        null,
        2
      ) + "\n"
    );
    process.exit(findings.filter((f) => f.severity === "error").length);
  }

  console.log();
  console.log(chalk.bold("AgentGuard policy audit"));
  console.log(chalk.gray(`  config:       ${getConfigPath()}`));
  console.log(chalk.gray(`  host-policy:  ${host.exists ? host.path : "(not present)"}`));
  if (missingPacks.length > 0) {
    console.log(
      chalk.yellow(`  ! missing packs in extends: ${missingPacks.join(", ")}`)
    );
  }
  if (host.missingPacks.length > 0) {
    console.log(
      chalk.yellow(`  ! missing packs in host-policy extends: ${host.missingPacks.join(", ")}`)
    );
  }
  console.log();

  if (findings.length === 0) {
    console.log(chalk.green("✓ No findings. Policy shape looks clean."));
    console.log();
    return;
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const infos = findings.filter((f) => f.severity === "info").length;

  for (const f of findings) {
    console.log(`${iconFor(f.severity)} ${chalk.bold(f.check)}`);
    console.log(`  ${f.message}`);
    if (f.ruleExcerpt) {
      console.log(chalk.gray(`  rule: ${f.ruleExcerpt}`));
    }
    console.log();
  }

  const summary = [
    errors > 0 ? chalk.red(`${errors} error${errors === 1 ? "" : "s"}`) : null,
    warnings > 0 ? chalk.yellow(`${warnings} warning${warnings === 1 ? "" : "s"}`) : null,
    infos > 0 ? chalk.blue(`${infos} info${infos === 1 ? "" : ""}`) : null,
  ]
    .filter(Boolean)
    .join(", ");
  console.log(summary);
  console.log();

  process.exit(errors);
}

function iconFor(sev: AuditFinding["severity"]): string {
  if (sev === "error") return chalk.red("✗");
  if (sev === "warning") return chalk.yellow("⚠");
  return chalk.blue("i");
}
