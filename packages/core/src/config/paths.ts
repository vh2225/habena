import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = ".agentguard";

export function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path === "~") {
    return homedir();
  }
  return path;
}

export function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR);
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.yaml");
}

export function getHostPolicyPath(): string {
  return join(getConfigDir(), "host-policy.yaml");
}

export function getAgentsPath(): string {
  return join(getConfigDir(), "agents.yaml");
}

export function getAuditDbPath(): string {
  return join(getConfigDir(), "audit.db");
}
