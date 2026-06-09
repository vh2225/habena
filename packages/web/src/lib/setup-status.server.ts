import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./config-dir";
import { proxyRunning } from "./approval-ipc";
import { summary } from "./audit";
import { parseSetupStatus, type SetupStatus } from "./setup-status";

/** IO wrapper: read the config dir + socket + audit count, then parse. (Server-only — imports better-sqlite3.) */
export function readSetupStatus(): SetupStatus {
  const configPath = join(configDir(), "config.yaml");
  const agentsPath = join(configDir(), "agents.yaml");
  const configExists = existsSync(configPath);
  const read = (p: string): string | null => {
    try {
      return existsSync(p) ? readFileSync(p, "utf8") : null;
    } catch {
      return null;
    }
  };
  let decisionCount = 0;
  try {
    decisionCount = summary().totalDecisions;
  } catch {
    decisionCount = 0;
  }
  return parseSetupStatus({
    configExists,
    configText: read(configPath),
    agentsText: read(agentsPath),
    proxyRunning: proxyRunning(),
    decisionCount,
  });
}
