# Dogfood findings — 2026-04-21

First serious attempt to route Vinh's morning-brief scripts through AgentGuard's proxy (stdio MCP) instead of calling Google APIs directly. Surfaced three real issues in ~20 min. Not a plan; just a punch list for later.

## 1. AgentGuard health check is process-liveness only, not auth-valid

`AgentGuard proxy started` reports `Downstreams: 2/2 alive`, but one of those downstreams returned `Authentication tokens are no longer valid` on the first actual tool call. AgentGuard only checks that the child process started, not that its credentials work.

**Impact:** "2/2 alive" is misleading. A user reading the startup banner assumes the stack is healthy.

**Fix direction:** On startup, issue a cheap read-only probe per downstream (e.g. `list-calendars`, `gmail_list_labels`). Report `alive + authenticated` vs `alive but unauthenticated`. This is a natural fit for the Phase 9 `doctor` spec (`downstream-reachable` check should include an auth probe, not just `initialize` MCP frame).

Touch: `packages/core/src/proxy/downstream.ts` (whichever does the startup probe).

## 2. Gmail MCP tool outputs are LLM-facing text, not machine-structured

`gmail_search` returns 370 chars of formatted text with emoji bullets, line breaks, and embedded `[id:...]` markers. Fine for GPT-4o-mini consumption; hostile for Node scripts that need structured data (message id, from, subject, date as separate fields).

**Impact:** Scripts wanting to dogfood AgentGuard have to regex-parse text to get message IDs back, or bypass the proxy and call Gmail directly. Today the scripts do the latter, which defeats the point.

**Fix direction (upstream):** `@antidrift/mcp-gmail` could accept a `format: "json" | "text"` param. Alternative fix AgentGuard can do without upstream: the proxy could optionally attach a `structuredContent` field alongside the text output for tools that have structured equivalents.

Not a V1 concern for AgentGuard-the-product, but worth flagging in any "integration guide" doc.

## 3. Each downstream MCP has its own OAuth/token convention

Two calendar + Gmail MCP servers had *three* different places to look for Google credentials:
- `@antidrift/mcp-gmail` → `~/.antidrift/credentials/google/{client.json, token.json}`
- `@cocal/google-calendar-mcp` → env var `GOOGLE_OAUTH_CREDENTIALS` for keys, and `~/.config/google-calendar-mcp/tokens.json` for tokens
- cocal's token file uses its own account-ID scheme (`[a-z0-9_-]{1,64}`) — emails don't qualify

**Impact:** Each new downstream adds N lines to a setup runbook. For AgentGuard to be a "just wire it up" proxy, it needs to offer either (a) a shared credential layer, or (b) clear per-server installer commands that handle auth.

**Fix direction:** Phase 4's `agentguard install openclaw` handles MCP-to-config migration but doesn't handle credential onboarding. A follow-on `agentguard downstream add <package> --oauth google` command that knows common conventions would close this gap.

## Positive signal

- `StdioClientTransport` from `@modelcontextprotocol/sdk` connects to `agentguard start` cleanly
- 27 tools fanned out across 2 downstreams with correct namespace handling
- `gmail_search` roundtrip through the proxy returned real data in <1s
- AgentGuard's shutdown on client close is clean (no zombie downstream processes)

## What Vinh's scripts actually do today

`morning-brief.mjs` and `urgent-watcher.mjs` in `vh2225/agentlab-scripts` call `googleapis` directly. They do NOT route through AgentGuard. Dogfooding today identified the gaps above; routing-through-proxy remains TODO pending either issue #2 fix or a decision to regex-parse the text output.
