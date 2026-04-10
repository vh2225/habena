/**
 * Official MCP Registry client.
 * https://registry.modelcontextprotocol.io
 */

import type { Registry, McpServerInfo } from "./types.js";

const REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0.1/servers";

export class OfficialRegistry implements Registry {
  name = "official";

  async search(query: string): Promise<McpServerInfo[]> {
    // TODO: GET /v0.1/servers?q=query
    throw new Error("Not implemented");
  }

  async lookup(serverName: string): Promise<McpServerInfo | null> {
    // TODO: GET /v0.1/servers/{namespace}/{name}
    throw new Error("Not implemented");
  }

  async enrich(server: McpServerInfo): Promise<McpServerInfo> {
    return { ...server, trustLevel: "verified", registry: this.name };
  }
}
