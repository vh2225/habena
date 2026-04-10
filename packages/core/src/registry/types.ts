/**
 * Registry abstractions — common interface for all MCP registries.
 */

export interface McpServerInfo {
  name: string;
  description?: string;
  registry: string;
  trustLevel: "verified" | "known" | "unknown";
  glamaGrade?: "A" | "B" | "C" | "D" | "F";
  url?: string;
  tools?: string[];
}

export interface Registry {
  name: string;
  search(query: string): Promise<McpServerInfo[]>;
  lookup(serverName: string): Promise<McpServerInfo | null>;
  enrich(server: McpServerInfo): Promise<McpServerInfo>;
}
