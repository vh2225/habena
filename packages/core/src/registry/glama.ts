/**
 * Glama security grade enrichment.
 * Fetches A-F security grades for MCP servers.
 */

import type { Registry, McpServerInfo } from "./types.js";

const GLAMA_API = "https://glama.ai/api/mcp/v1/servers";

export class GlamaRegistry implements Registry {
  name = "glama";

  async search(query: string): Promise<McpServerInfo[]> {
    // TODO: Search Glama API
    throw new Error("Not implemented");
  }

  async lookup(serverName: string): Promise<McpServerInfo | null> {
    // TODO: GET /api/mcp/v1/servers/{namespace}/{name}
    throw new Error("Not implemented");
  }

  async enrich(server: McpServerInfo): Promise<McpServerInfo> {
    // TODO: Fetch security grade and attach to server info
    throw new Error("Not implemented");
  }
}
