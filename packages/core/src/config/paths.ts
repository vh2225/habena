import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";

const HABENA_DIR = ".habena";
const LEGACY_DIR = ".agentguard";

let warnedLegacy = false;

export function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path === "~") {
    return homedir();
  }
  return path;
}

/**
 * Resolve the config directory.
 *
 * Precedence:
 *   1. HABENA_CONFIG_DIR env override (preferred).
 *   2. AGENTGUARD_CONFIG_DIR env override (legacy fallback).
 *   3. ~/.habena if it exists.
 *   4. ~/.agentguard if it exists (legacy) — emits a one-line deprecation notice.
 *   5. ~/.habena (the canonical default) when neither exists.
 */
export function getConfigDir(): string {
  const override = process.env.HABENA_CONFIG_DIR ?? process.env.AGENTGUARD_CONFIG_DIR;
  if (override && override.trim() !== "") {
    return expandHome(override.trim());
  }

  const habenaDir = join(homedir(), HABENA_DIR);
  if (existsSync(habenaDir)) {
    return habenaDir;
  }

  const legacyDir = join(homedir(), LEGACY_DIR);
  if (existsSync(legacyDir)) {
    if (!warnedLegacy) {
      warnedLegacy = true;
      console.error("! using legacy ~/.agentguard (rename to ~/.habena when convenient)");
    }
    return legacyDir;
  }

  return habenaDir;
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
