import { DownstreamClient } from "./client.js";
import type {
  DownstreamServerConfig,
  AggregatedTool,
  ToolOwner,
  DownstreamServerStatus,
} from "./types.js";

export class DownstreamManager {
  private clients: Map<string, DownstreamClient> = new Map();
  private errors: Map<string, string> = new Map();
  private tools: AggregatedTool[] = [];
  private ownerIndex: Map<string, ToolOwner> = new Map();

  constructor(private configs: Record<string, DownstreamServerConfig>) {}

  async start(): Promise<void> {
    // Spawn all servers in parallel; isolate failures per server.
    const entries = Object.entries(this.configs);
    await Promise.all(
      entries.map(async ([name, config]) => {
        const client = new DownstreamClient(name, config);
        try {
          await client.start();
          this.clients.set(name, client);
        } catch (err) {
          this.errors.set(name, (err as Error).message);
        }
      })
    );

    this.rebuildToolIndex();
  }

  async stop(): Promise<void> {
    await Promise.all(
      Array.from(this.clients.values()).map((c) => c.stop().catch(() => {}))
    );
    this.clients.clear();
    this.errors.clear();
    this.tools = [];
    this.ownerIndex.clear();
  }

  listTools(): AggregatedTool[] {
    return this.tools.slice();
  }

  findTool(name: string): ToolOwner | undefined {
    return this.ownerIndex.get(name);
  }

  async forward(
    server: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const client = this.clients.get(server);
    if (!client) {
      throw new Error(`Downstream ${server} is not available`);
    }
    return await client.callTool(toolName, args);
  }

  status(): DownstreamServerStatus[] {
    const all: DownstreamServerStatus[] = [];
    for (const name of Object.keys(this.configs)) {
      const client = this.clients.get(name);
      if (client && client.isAlive()) {
        all.push({
          name,
          alive: true,
          toolCount: client.listTools().length,
          authStatus: client.authStatus(),
          authError: client.authError(),
        });
      } else {
        all.push({
          name,
          alive: false,
          toolCount: 0,
          error: this.errors.get(name) ?? "not started",
          authStatus: "unchecked",
        });
      }
    }
    return all;
  }

  private rebuildToolIndex(): void {
    this.tools = [];
    this.ownerIndex.clear();

    // First pass: collect (server, originalName) pairs
    const toolsByServer = new Map<string, string[]>();
    for (const [name, client] of this.clients.entries()) {
      toolsByServer.set(name, client.listTools().map((t) => t.originalName));
    }

    // Detect collisions (any tool name appearing in 2+ servers)
    const nameCounts = new Map<string, number>();
    for (const names of toolsByServer.values()) {
      for (const n of names) {
        nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
      }
    }
    const colliding = new Set(
      Array.from(nameCounts.entries()).filter(([, c]) => c > 1).map(([n]) => n)
    );

    // Any server that hosts a colliding tool gets ALL its tools prefixed
    const serversNeedingPrefix = new Set<string>();
    for (const [server, names] of toolsByServer.entries()) {
      const cfg = this.configs[server];
      if (cfg?.namespace) {
        serversNeedingPrefix.add(server);
        continue;
      }
      if (names.some((n) => colliding.has(n))) {
        serversNeedingPrefix.add(server);
      }
    }

    // Second pass: build the public tool list with appropriate prefixes
    for (const [server, client] of this.clients.entries()) {
      const cfg = this.configs[server];
      const prefix = cfg?.namespace
        ? `${cfg.namespace}/`
        : serversNeedingPrefix.has(server)
        ? `${server}/`
        : "";

      for (const tool of client.listTools()) {
        const publicName = prefix + tool.originalName;
        const aggregated: AggregatedTool = {
          name: publicName,
          originalName: tool.originalName,
          description: tool.description,
          inputSchema: tool.inputSchema,
          server,
        };
        this.tools.push(aggregated);
        this.ownerIndex.set(publicName, { server, originalName: tool.originalName });
      }
    }
  }
}
