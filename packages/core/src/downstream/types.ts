export type DownstreamTransport = "stdio";

export interface DownstreamServerConfig {
  /** Command to spawn the downstream MCP server. */
  command: string;
  args?: string[];
  transport?: DownstreamTransport;  // defaults to "stdio"
  env?: Record<string, string>;
  /**
   * Force a tool-name prefix. If set, all tools from this server are exposed
   * as `<namespace>/<toolName>`. If unset, auto-prefixing kicks in only when
   * multiple servers expose the same tool name.
   */
  namespace?: string;
}

export interface AggregatedTool {
  /** The public name exposed to MCP clients (may include a namespace prefix). */
  name: string;
  /** The original name as the downstream server exposes it. */
  originalName: string;
  description?: string;
  inputSchema?: unknown;
  /** The name of the downstream server this tool comes from. */
  server: string;
}

export interface ToolOwner {
  server: string;
  originalName: string;
}

export interface DownstreamServerStatus {
  name: string;
  alive: boolean;
  toolCount: number;
  error?: string;
}
