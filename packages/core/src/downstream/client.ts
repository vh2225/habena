import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  DownstreamServerConfig,
  AggregatedTool,
  AuthProbeStatus,
} from "./types.js";
import { expandEnvInConfig } from "./env-expand.js";

/**
 * Environment variables a downstream config must NOT override. A
 * malicious config with `env: { PATH: "/tmp/evil:${PATH}" }` would
 * otherwise poison the lookup path of the spawned child. Callers that
 * write config.yaml can still set their own PATH on purpose by
 * providing the full absolute `command`. Security review M1.
 */
const ENV_SHADOW_DENYLIST = new Set([
  "PATH",
  "NODE_OPTIONS",
  "NODE_PATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
]);

export function sanitizeEnv(
  configEnv: Record<string, string> | undefined
): Record<string, string> {
  if (!configEnv) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(configEnv)) {
    if (ENV_SHADOW_DENYLIST.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * A single downstream MCP server under Habena's management.
 * Spawns the configured child process, maintains an MCP Client,
 * caches the tool list, and forwards callTool requests.
 */
export class DownstreamClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: AggregatedTool[] = [];
  private alive = false;
  private authProbeStatus: AuthProbeStatus = "unchecked";
  private authProbeError: string | undefined;

  constructor(
    public readonly name: string,
    private config: DownstreamServerConfig
  ) {}

  async start(): Promise<void> {
    // Security M1: sanitize config.env before using it as the expansion
    // context. Otherwise `env: { PATH: "/tmp/evil:${PATH}" }` would let a
    // poisoned config redirect the `command` lookup. Only expand string
    // interpolation against process.env; ignore any shadow keys the
    // config tries to set.
    const sanitizedConfigEnv = sanitizeEnv(this.config.env);
    const expansionContext = {
      ...(process.env as Record<string, string | undefined>),
      ...sanitizedConfigEnv,
    };
    const expandedConfig = expandEnvInConfig(
      { ...this.config, env: sanitizedConfigEnv },
      expansionContext
    );

    // Scripts written to a tmpdir or test fixture often can't resolve
    // MCP SDK imports. Drop a node_modules symlink pointing at our
    // workspace so the child can find them. Best-effort — failures are
    // fine (the server may have its own node_modules or be installed
    // globally). The symlink target is always our own trusted tree;
    // the location follows whatever script the user configured.
    const firstArg = expandedConfig.args?.[0];
    if (firstArg && /\.(mjs|js)$/.test(firstArg)) {
      const scriptDir = dirname(firstArg);
      const workspaceNodeModules = new URL("../../node_modules", import.meta.url).pathname;
      const symlinkPath = join(scriptDir, "node_modules");
      if (!existsSync(symlinkPath) && existsSync(workspaceNodeModules)) {
        try {
          symlinkSync(workspaceNodeModules, symlinkPath, "dir");
        } catch {
          // ignore
        }
      }
    }

    this.transport = new StdioClientTransport({
      command: expandedConfig.command,
      args: expandedConfig.args ?? [],
      env: expandedConfig.env as Record<string, string> | undefined,
    });

    this.client = new Client(
      { name: "agentguard-downstream-client", version: "0.1.0" },
      { capabilities: {} }
    );

    await this.client.connect(this.transport);
    this.alive = true;

    await this.fetchTools();

    // Auth probe: listTools() succeeds even for servers that can't
    // authenticate. If the user configured a probe, call it now and record
    // the result so `status()` can surface auth failures at startup.
    if (this.config.auth_probe) {
      const { tool, args } = this.config.auth_probe;
      try {
        const res = await this.client.callTool({ name: tool, arguments: args ?? {} });
        // MCP convention: isError === true means the tool returned a
        // structured error (auth failure, permission denied, etc.) even
        // though the RPC itself succeeded.
        const resErr = (res as { isError?: boolean; content?: Array<{ type?: string; text?: string }> });
        if (resErr.isError) {
          this.authProbeStatus = "auth_failed";
          const firstText = resErr.content?.find((c) => c.type === "text")?.text;
          this.authProbeError = firstText?.slice(0, 300) ?? "probe returned isError with no message";
        } else {
          this.authProbeStatus = "authenticated";
        }
      } catch (err) {
        this.authProbeStatus = "auth_failed";
        this.authProbeError = (err as Error).message.slice(0, 300);
      }
    }
  }

  async stop(): Promise<void> {
    this.alive = false;
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // ignore
      }
      this.client = null;
    }
    this.transport = null;
    this.tools = [];
  }

  isAlive(): boolean {
    return this.alive;
  }

  authStatus(): AuthProbeStatus {
    return this.authProbeStatus;
  }

  authError(): string | undefined {
    return this.authProbeError;
  }

  listTools(): AggregatedTool[] {
    return this.tools.slice();
  }

  /**
   * Re-fetch the tool list from the live server (mid-session refresh).
   * Throws on failure and leaves the cached list untouched, so a transient
   * error never empties a server's catalog.
   */
  async refreshTools(): Promise<void> {
    if (!this.client || !this.alive) {
      throw new Error(`Downstream ${this.name} is not alive`);
    }
    await this.fetchTools();
  }

  private async fetchTools(): Promise<void> {
    const result = await this.client!.listTools();
    this.tools = result.tools.map((t) => ({
      name: t.name,                    // will be re-namespaced by manager
      originalName: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      server: this.name,
    }));
  }

  async callTool(originalName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client || !this.alive) {
      throw new Error(`Downstream ${this.name} is not alive`);
    }
    return await this.client.callTool({
      name: originalName,
      arguments: args,
    });
  }
}
