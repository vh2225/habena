import { writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { getConfigPath } from "../config/paths.js";
import { loadYaml } from "../config/loader.js";
import type { AgentGuardConfig } from "../policy/types.js";
import type { DownstreamServerConfig } from "../downstream/types.js";

export interface AddServerOptions {
  /** Don't actually write; log what would happen. */
  dryRun?: boolean;
  /** Overwrite an existing entry with the same name. */
  force?: boolean;
}

export interface AddServerResult {
  configPath: string;
  backupPath?: string;
  name: string;
  wrote: boolean;
}

/**
 * Atomically add (or replace) a named MCP server in ~/.habena/config.yaml.
 * Backs the existing config up before writing. Callers own the OAuth /
 * package-install side effects — this function only touches config.yaml.
 */
export function addDownstreamServer(
  name: string,
  server: DownstreamServerConfig,
  options: AddServerOptions = {}
): AddServerResult {
  const configPath = getConfigPath();
  const existing = loadYaml<AgentGuardConfig>(configPath) ?? {};
  const servers = existing.mcp_servers ?? {};

  if (servers[name] && !options.force) {
    throw new Error(
      `mcp_servers.${name} already exists in ${configPath}. Re-run with --force to replace.`
    );
  }

  const updated: AgentGuardConfig = {
    ...existing,
    mcp_servers: { ...servers, [name]: server },
  };
  const yaml = stringifyYaml(updated);

  if (options.dryRun) {
    return { configPath, name, wrote: false };
  }

  let backupPath: string | undefined;
  if (existsSync(configPath)) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = `${configPath}.backup-${ts}`;
    copyFileSync(configPath, backupPath);
  } else {
    mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  }

  writeFileSync(configPath, yaml, { mode: 0o600 });
  return { configPath, backupPath, name, wrote: true };
}

/**
 * Remove a server. Returns whether it existed.
 */
export function removeDownstreamServer(name: string): boolean {
  const configPath = getConfigPath();
  const existing = loadYaml<AgentGuardConfig>(configPath) ?? {};
  const servers = existing.mcp_servers ?? {};
  if (!servers[name]) return false;

  const { [name]: _removed, ...rest } = servers;
  const updated: AgentGuardConfig = { ...existing, mcp_servers: rest };

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(configPath, `${configPath}.backup-${ts}`);
  writeFileSync(configPath, stringifyYaml(updated), { mode: 0o600 });
  return true;
}

export function listDownstreamServers(): Record<string, DownstreamServerConfig> {
  const configPath = getConfigPath();
  const existing = loadYaml<AgentGuardConfig>(configPath) ?? {};
  return existing.mcp_servers ?? {};
}
