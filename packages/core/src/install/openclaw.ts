import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpenclawStdioServer {
  command: string;
  args?: string[];
  env?: Record<string, string | number | boolean>;
  cwd?: string;
  workingDirectory?: string;
}

export interface OpenclawHttpServer {
  url: string;
  headers?: Record<string, string | number | boolean>;
  transport?: "sse" | "streamable-http";
  connectionTimeoutMs?: number;
}

export type OpenclawMcpServer = OpenclawStdioServer | OpenclawHttpServer;

export interface OpenclawConfig {
  mcp?: {
    servers?: Record<string, OpenclawMcpServer>;
  };
  [key: string]: unknown;
}

export interface InstallOptions {
  openclawConfigPath?: string;
  agentguardBinaryPath: string;
  agentguardConfigPath?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface InstallResult {
  backupPath: string | null;
  migratedServers: string[];
  openclawConfigPath: string;
  agentguardConfigPath: string;
  agentGuardEntry: OpenclawStdioServer;
}

export interface UninstallOptions {
  openclawConfigPath?: string;
  backupPath?: string;
}

export interface UninstallResult {
  restored: boolean;
  restoredFrom: string | null;
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

export function getOpenclawConfigPath(): string {
  if (process.env.OPENCLAW_CONFIG_PATH) {
    return process.env.OPENCLAW_CONFIG_PATH;
  }
  return join(homedir(), ".openclaw", "openclaw.json");
}

function getAgentGuardConfigPath(): string {
  return join(homedir(), ".agentguard", "config.yaml");
}

// ─── Read / write ─────────────────────────────────────────────────────────────

export function readOpenclawConfig(path: string): OpenclawConfig | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as OpenclawConfig;
}

export function writeOpenclawConfig(path: string, config: OpenclawConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), "utf8");
}

// ─── Backup ───────────────────────────────────────────────────────────────────

export function backupConfig(path: string): string {
  const iso = new Date().toISOString().replace(/:/g, "-").replace(/\..+$/, "");
  const backupPath = `${path}.backup-${iso}`;
  const content = readFileSync(path, "utf8");
  writeFileSync(backupPath, content, "utf8");
  return backupPath;
}

function findLatestBackup(openclawConfigPath: string): string | null {
  const dir = dirname(openclawConfigPath);
  const base = openclawConfigPath.split("/").pop()!;
  if (!existsSync(dir)) return null;
  const backups = readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.backup-`))
    .sort()
    .reverse();
  if (backups.length === 0) return null;
  return join(dir, backups[0]);
}

// ─── Migration logic ──────────────────────────────────────────────────────────

function isStdioServer(server: OpenclawMcpServer): server is OpenclawStdioServer {
  return "command" in server;
}

export function migrateServersToAgentGuard(
  openclawConfig: OpenclawConfig,
  agentGuardPath: string
): {
  migratedServers: Record<string, OpenclawStdioServer>;
  newOpenclawConfig: OpenclawConfig;
} {
  // Deep clone
  const newConfig: OpenclawConfig = JSON.parse(JSON.stringify(openclawConfig));

  const servers = newConfig.mcp?.servers ?? {};
  const migratedServers: Record<string, OpenclawStdioServer> = {};
  const keptServers: Record<string, OpenclawMcpServer> = {};

  for (const [name, server] of Object.entries(servers)) {
    // Skip existing agentguard entry — it will be replaced
    if (name === "agentguard") continue;
    if (isStdioServer(server)) {
      migratedServers[name] = server;
    } else {
      keptServers[name] = server;
    }
  }

  // Build AgentGuard entry
  const agentGuardEntry: OpenclawStdioServer = {
    command: "node",
    args: [agentGuardPath, "start"],
  };

  // Replace servers: keep HTTP ones + add agentguard entry
  if (!newConfig.mcp) {
    newConfig.mcp = {};
  }
  newConfig.mcp.servers = {
    ...keptServers,
    agentguard: agentGuardEntry,
  };

  return { migratedServers, newOpenclawConfig: newConfig };
}

// ─── AgentGuard config helpers ────────────────────────────────────────────────

interface AgentGuardConfig {
  rules?: unknown[];
  mcp_servers?: Record<string, unknown>;
  [key: string]: unknown;
}

function readAgentGuardConfig(path: string): AgentGuardConfig {
  if (!existsSync(path)) {
    return {
      rules: [{ match: { tool: "*" }, action: "allow" }],
      mcp_servers: {},
    };
  }
  const raw = readFileSync(path, "utf8");
  const parsed = parseYaml(raw) as AgentGuardConfig;
  return parsed ?? { rules: [], mcp_servers: {} };
}

function writeAgentGuardConfig(path: string, config: AgentGuardConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyYaml(config), "utf8");
}

function mergeIntoAgentGuardConfig(
  agConfig: AgentGuardConfig,
  migratedServers: Record<string, OpenclawStdioServer>
): AgentGuardConfig {
  const existing = agConfig.mcp_servers ?? {};
  const merged: Record<string, unknown> = { ...existing };

  for (const [name, serverDef] of Object.entries(migratedServers)) {
    const targetName = name in merged ? `openclaw_${name}` : name;
    if (name in merged) {
      console.warn(
        `Warning: AgentGuard config already has a server named "${name}", migrating as "${targetName}"`
      );
    }
    merged[targetName] = serverDef;
  }

  return { ...agConfig, mcp_servers: merged };
}

// ─── Install ──────────────────────────────────────────────────────────────────

export async function installOpenclaw(options: InstallOptions): Promise<InstallResult> {
  const openclawConfigPath = options.openclawConfigPath ?? getOpenclawConfigPath();
  const agentguardConfigPath = options.agentguardConfigPath ?? getAgentGuardConfigPath();

  // 1. Check OpenClaw config exists
  if (!existsSync(openclawConfigPath)) {
    throw new Error(
      `OpenClaw config not found at ${openclawConfigPath}. ` +
        "OpenClaw not installed or not onboarded — run `openclaw onboard` first."
    );
  }

  // 2. Read the config
  const openclawConfig = readOpenclawConfig(openclawConfigPath)!;

  // 3. Check if already installed
  const existingServers = openclawConfig.mcp?.servers ?? {};
  if ("agentguard" in existingServers && !options.force) {
    throw new Error(
      "AgentGuard already installed in OpenClaw — use --force to overwrite."
    );
  }

  // 4. Migrate servers
  const { migratedServers, newOpenclawConfig } = migrateServersToAgentGuard(
    openclawConfig,
    options.agentguardBinaryPath
  );

  const agentGuardEntry = newOpenclawConfig.mcp?.servers?.agentguard as OpenclawStdioServer;

  // 5. Read AgentGuard config
  const agConfig = readAgentGuardConfig(agentguardConfigPath);

  // 6. Merge migrated servers into AgentGuard config
  const newAgConfig = mergeIntoAgentGuardConfig(agConfig, migratedServers);

  const result: InstallResult = {
    backupPath: null,
    migratedServers: Object.keys(migratedServers),
    openclawConfigPath,
    agentguardConfigPath,
    agentGuardEntry,
  };

  // 7. Dry run: return without writing
  if (options.dryRun) {
    return result;
  }

  // 8. Write files
  const backupPath = backupConfig(openclawConfigPath);
  result.backupPath = backupPath;

  writeOpenclawConfig(openclawConfigPath, newOpenclawConfig);
  writeAgentGuardConfig(agentguardConfigPath, newAgConfig);

  return result;
}

// ─── Uninstall ────────────────────────────────────────────────────────────────

export async function uninstallOpenclaw(options: UninstallOptions): Promise<UninstallResult> {
  const openclawConfigPath = options.openclawConfigPath ?? getOpenclawConfigPath();

  // Find backup
  const backupPath = options.backupPath ?? findLatestBackup(openclawConfigPath);

  if (!backupPath || !existsSync(backupPath)) {
    throw new Error(
      `No backup found for ${openclawConfigPath}. Cannot uninstall without a backup.`
    );
  }

  // Restore backup
  const backupContent = readFileSync(backupPath, "utf8");
  writeFileSync(openclawConfigPath, backupContent, "utf8");

  return {
    restored: true,
    restoredFrom: backupPath,
  };
}
