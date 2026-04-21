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
 * A single downstream MCP server under AgentGuard's management.
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
    const expandedConfig = expandEnvInConfig(this.config, {
      ...(process.env as Record<string, string | undefined>),
      ...(this.config.env ?? {}),
    });

    // When the first arg is a .mjs script that lives outside the workspace
    // (e.g. in a temp directory during tests), ESM bare-specifier resolution
    // won't find packages in this project's node_modules.  Create a temporary
    // node_modules symlink next to the script so that Node's standard upward
    // search finds the workspace packages.
    const firstArg = expandedConfig.args?.[0];
    if (firstArg && /\.(mjs|js)$/.test(firstArg)) {
      const scriptDir = dirname(firstArg);
      const symlinkPath = join(scriptDir, "node_modules");
      const workspaceNodeModules = new URL("../../node_modules", import.meta.url).pathname;
      if (!existsSync(symlinkPath) && existsSync(workspaceNodeModules)) {
        try {
          symlinkSync(workspaceNodeModules, symlinkPath, "dir");
        } catch {
          // If we can't create the symlink, proceed anyway — the server may
          // have its own node_modules or be globally installed.
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

    const result = await this.client.listTools();
    this.tools = result.tools.map((t) => ({
      name: t.name,                    // will be re-namespaced by manager
      originalName: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      server: this.name,
    }));

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
