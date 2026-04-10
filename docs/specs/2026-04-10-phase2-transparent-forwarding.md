# Phase 2 — Transparent MCP Forwarding Spec

**Date:** 2026-04-10
**Status:** Approved (in-session)
**Depends on:** Phase 1 (core MVP) + Phase 3a (approval backend), both merged to main

## Goal

Replace the Phase 1 meta-tool (`agentguard_proxy`) with a transparent forwarding proxy. AgentGuard should spawn real downstream MCP servers, aggregate their tool catalogs, and transparently forward `tools/call` requests with policy enforcement in the middle — so real MCP clients like OpenClaw work against it without modification.

## Problem

Phase 1 exposes a single meta-tool `agentguard_proxy(tool_name, tool_args)`. Real MCP clients auto-discover tools via `tools/list` and call them by name. OpenClaw, Claude Desktop, Cursor, and other mainstream MCP clients cannot use the meta-tool pattern. Until Phase 2, AgentGuard cannot be a drop-in proxy for real agents.

## Architecture

```
┌──────────────────┐
│   MCP Client     │  (OpenClaw, Claude Desktop, etc.)
│                  │
│  tools/list ────▶│───────┐
│  tools/call ────▶│───────┤
└──────────────────┘       │ stdio JSON-RPC
                           ▼
        ┌──────────────────────────────────────┐
        │       AgentGuard Proxy Server         │
        │                                        │
        │  ┌────────────────────────────────┐   │
        │  │ tools/list handler              │   │
        │  │   aggregate from downstreams    │   │
        │  └────────────────────────────────┘   │
        │                                        │
        │  ┌────────────────────────────────┐   │
        │  │ tools/call handler              │   │
        │  │   1. policy check               │   │
        │  │   2. budget check               │   │
        │  │   3. approval (if needed)       │   │
        │  │   4. forward to downstream      │   │
        │  │   5. audit log                  │   │
        │  └────────────────────────────────┘   │
        │                                        │
        │  ┌────────────────────────────────┐   │
        │  │ DownstreamManager               │   │
        │  │   - spawns each MCP server      │   │
        │  │   - maintains MCP Client per    │   │
        │  │   - tracks tool ownership       │   │
        │  └────────────────────────────────┘   │
        └──────────────────────────────────────┘
                    │
      ┌─────────────┼─────────────┐
      │ stdio       │ stdio       │ stdio
      ▼             ▼             ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ filesystem│ │ github   │ │ gmail    │
│ MCP server│ │ MCP      │ │ MCP      │
└──────────┘ └──────────┘ └──────────┘
```

## Design

### Downstream server configuration

New optional `mcp_servers` block in `~/.agentguard/config.yaml` with the same schema as Claude Desktop / OpenClaw:

```yaml
mcp_servers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/vinh.hoang/workspace"]
    transport: stdio
    env:
      LOG_LEVEL: info
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    transport: stdio
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
```

Only `stdio` transport is in scope for Phase 2. `http` transport is deferred.

Environment variable substitution: `${VAR}` in any string field is replaced with `process.env.VAR` at spawn time. Missing vars become empty strings with a warning.

### DownstreamManager

New class responsible for the lifecycle of downstream MCP servers.

```ts
class DownstreamManager {
  async start(): Promise<void>         // spawn all configured servers, connect MCP clients, cache tool lists
  async stop(): Promise<void>          // SIGTERM each child, wait for clean exit
  listTools(): AggregatedTool[]        // returns all tools from all alive downstreams
  findTool(name: string): ToolOwner | undefined  // maps tool name → which downstream owns it
  async forward(server: string, toolName: string, args: Record<string, unknown>): Promise<unknown>
}

interface AggregatedTool {
  name: string;            // may be auto-namespaced (see collision rules)
  originalName: string;    // name as the downstream server exposes it
  description?: string;
  inputSchema?: unknown;
  server: string;          // downstream server name from config
}
```

### Tool name collision handling

If two or more downstream servers expose a tool with the same name, AgentGuard auto-namespaces them with a `server/` prefix:

```
Before:                      After:
  filesystem: [read, write]    filesystem/read
  github:     [read, search]   filesystem/write
                               github/read
                               github/search
```

Collision detection happens at startup during tool aggregation. If no collisions, names are passed through as-is. If collisions exist, **all affected tools** get the prefix (not just the duplicates) so the aliasing is consistent per server.

Additionally, users can force namespacing via config:

```yaml
mcp_servers:
  filesystem:
    namespace: fs
    command: ...
```

Forced namespacing always wins: `fs/read`, `fs/write`.

### Tool discovery cache

On startup, `DownstreamManager.start()` calls `tools/list` on each downstream MCP client and caches the results in-memory. The cache is only refreshed on explicit admin command (future) or when a downstream reconnects after crash.

Calling `listTools()` from the handler is O(1) — no downstream roundtrip per request.

### tools/list handler

When an MCP client calls `tools/list` on AgentGuard, the handler returns the aggregated tool list from `DownstreamManager.listTools()`, adding a `server` attribute to each tool's metadata (mostly for debugging — MCP clients ignore extra fields).

Dead downstream servers are skipped silently. The logs show a warning but the client sees a partial tool catalog rather than a hard error.

### tools/call handler

The new flow, replacing the Phase 1 meta-tool:

```
1. Client calls tools/call with { name, arguments }
2. Look up tool owner via DownstreamManager.findTool(name)
   - Unknown tool → return MCP error
3. Build ToolCallRequest from the call:
   - agentType: detected from MCP client metadata or "unknown"
   - instanceId: per-session UUID (created on MCP connect)
   - tool: the original (unprefixed) tool name
   - args: arguments
   - mcpServer: the downstream server name
   - estimatedCost: 0 for Phase 2 (real cost tracking stays LLM-call scope, out of scope here)
4. Run dispatcher.handleToolCall(request) → gets PolicyDecision
5. If allow:
   - await downstreamManager.forward(server, originalName, args)
   - return result as MCP tool call response
6. If deny/require_approval_denied/hard_boundary:
   - return MCP error with the decision reason
```

The dispatcher already does policy + budget + approval + audit logging. Phase 2 just adds the forwarding step at the end.

### Agent identification

How does AgentGuard know which agent is calling? Three strategies in priority order:

1. **MCP client `clientInfo.name`** — MCP protocol exposes this in the `initialize` handshake. If it matches a registered agent name in `agents.yaml`, use it. OpenClaw sends `clientInfo.name = "openclaw"` for example.
2. **Env var override** — if `AGENTGUARD_AGENT=openclaw` is set in the downstream invocation (e.g., MCP client's env), use it.
3. **Fallback** — `unknown` agent with default budget and permissions.

For Phase 2, we implement strategies 1 and 3. Strategy 2 is a follow-up if needed.

### Instance tracking

Each MCP client connection gets a new `InstanceTracker` instance on `initialize`. The instance is stopped on MCP disconnect. This ensures per-session budget caps actually work — reconnecting is a fresh session.

### Removal of `agentguard_proxy` meta-tool

The meta-tool was a Phase 1 workaround. It is removed in Phase 2. Any existing configs that relied on it will break cleanly with a descriptive error.

### Error handling

- **Downstream spawn failure** — logged at startup with the command that failed; that server is marked dead; other servers continue
- **Downstream crash mid-session** — detected via exit event; tools from that server become unavailable; AgentGuard returns MCP error on subsequent calls; logged for later reconnect
- **Downstream call error** — forwarded to the MCP client as an MCP tool call error with the downstream's error message
- **Unknown tool** — MCP protocol error: `-32601 Method not found` with tool name

### Policy Engine changes

No changes in Phase 2. The existing 3-tier engine works as-is. The only thing Phase 2 adds is the forwarding step after a policy `allow` decision.

## Out of Scope for Phase 2

- HTTP transport for downstream MCP servers (stdio only)
- Dynamic downstream reload (add/remove without restart)
- LLM token counting / cost estimation for downstream calls
- Streaming tool responses (reply after downstream completes)
- Multi-agent sessions (each MCP connection is one agent)
- Tool arg schema validation (trust the downstream)

## Files to Create or Modify

### New
- `packages/core/src/downstream/manager.ts` — `DownstreamManager` class
- `packages/core/src/downstream/client.ts` — wrapper around MCP SDK Client
- `packages/core/src/downstream/types.ts` — `DownstreamServerConfig`, `AggregatedTool`, `ToolOwner`
- `packages/core/src/downstream/env-expand.ts` — `${VAR}` substitution helper
- Tests for each module
- `packages/core/tests/e2e/forwarding.test.ts` — end-to-end test with real filesystem server

### Modify
- `packages/core/src/policy/types.ts` — add `mcp_servers` to `AgentGuardConfig`
- `packages/core/src/proxy/server.ts` — remove meta-tool, use `DownstreamManager`
- `packages/core/src/proxy/forwarder.ts` — repurpose or delete (the old `Forwarder` stub can become `DownstreamManager`, or be kept as a thin wrapper)
- `packages/core/src/cli/commands/start.ts` — create `DownstreamManager`, wire into dispatcher
- `packages/core/src/identity/instances.ts` — add per-MCP-connection instance lifecycle if needed
- `packages/core/tests/e2e/cli-smoke.test.ts` — update existing smoke to not rely on meta-tool

## Success Criteria

1. `agentguard start` spawns configured downstream MCP servers from `config.yaml`
2. An MCP client calling `tools/list` on AgentGuard sees the union of all downstream tools
3. An MCP client calling `tools/call github_search` gets forwarded to the github downstream, with policy enforcement applied first
4. `tools/call rm -rf /` path triggers hard boundary deny without ever calling the downstream
5. `tools/call gmail_send` triggers approval via IPC watcher, downstream call only happens after approval
6. Downstream crash does not kill AgentGuard — the other downstreams continue serving their tools
7. E2E test against the real `@modelcontextprotocol/server-filesystem` server passes
8. OpenClaw can be configured with AgentGuard as its sole MCP server entry and see all downstream tools
