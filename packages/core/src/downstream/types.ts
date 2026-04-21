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
  /**
   * Optional read-only tool call to verify credentials after the server starts.
   * listTools() succeeds even when a server is unauthenticated, so without a
   * probe "alive" only means the child process started. Set this to a cheap
   * tool (e.g. gmail_list_labels, list-calendars) to surface auth failures up
   * front instead of on the first real call.
   */
  auth_probe?: {
    tool: string;
    args?: Record<string, unknown>;
  };
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

export type AuthProbeStatus =
  | "unchecked"     // no auth_probe configured
  | "authenticated" // probe call succeeded
  | "auth_failed";  // probe call returned an error

export interface DownstreamServerStatus {
  name: string;
  alive: boolean;
  toolCount: number;
  error?: string;
  authStatus: AuthProbeStatus;
  /** Error text from the auth probe (only present when authStatus === "auth_failed"). */
  authError?: string;
}
