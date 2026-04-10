/**
 * Smithery Connect integration.
 * Uses @smithery/api SDK for managed MCP server connections.
 */

import type { Registry, McpServerInfo } from "./types.js";

export class SmitheryRegistry implements Registry {
  name = "smithery";

  async search(query: string): Promise<McpServerInfo[]> {
    // TODO: Use @smithery/api to search servers
    throw new Error("Not implemented");
  }

  async lookup(serverName: string): Promise<McpServerInfo | null> {
    // TODO: Lookup server via Smithery API
    throw new Error("Not implemented");
  }

  async enrich(server: McpServerInfo): Promise<McpServerInfo> {
    return { ...server, trustLevel: "known", registry: this.name };
  }
}
