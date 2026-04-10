/**
 * Forwards approved tool calls to downstream MCP servers.
 * Manages connections to multiple MCP servers and routes calls
 * based on tool name → server mapping from config.
 */

export interface DownstreamServer {
  name: string;
  url?: string;
  command?: string;
  args?: string[];
  registry?: string;
}

export class Forwarder {
  private servers: Map<string, DownstreamServer> = new Map();

  async addServer(server: DownstreamServer): Promise<void> {
    this.servers.set(server.name, server);
  }

  async forward(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    // TODO: Forward tool call to downstream MCP server
    throw new Error("Not implemented");
  }

  async disconnect(): Promise<void> {
    // TODO: Close all downstream connections
  }
}
