export interface DownstreamServer {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  toolPrefixes?: string[];
  registry?: string;
}

export class Forwarder {
  private servers: Map<string, DownstreamServer> = new Map();

  addServer(server: DownstreamServer): void {
    this.servers.set(server.name, server);
  }

  removeServer(name: string): void {
    this.servers.delete(name);
  }

  listServers(): DownstreamServer[] {
    return Array.from(this.servers.values());
  }

  routeFor(toolName: string): DownstreamServer | undefined {
    for (const server of this.servers.values()) {
      if (!server.toolPrefixes) continue;
      if (server.toolPrefixes.some((prefix) => toolName.startsWith(prefix))) {
        return server;
      }
    }
    return undefined;
  }

  async forward(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    // Phase 2: actually connect to the downstream MCP server and forward.
    // For Phase 1, this is a stub that will be wired to real MCP clients later.
    throw new Error("Forwarder.forward not yet wired to downstream MCP clients");
  }
}
