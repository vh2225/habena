# Phase 2 Implementation Plan — Transparent MCP Forwarding

**Goal:** Replace Phase 1's meta-tool with a real transparent MCP forwarding proxy that spawns downstream MCP servers, aggregates their tool catalogs, and forwards calls with full policy enforcement.

**Architecture:** New `downstream/` module contains `DownstreamManager` which owns the lifecycle of child MCP server processes, each wrapped in an MCP SDK `Client`. The MCP `Server` in `proxy/server.ts` exposes aggregated tools via `tools/list` and routes `tools/call` through the dispatcher, then forwards allowed calls to the owning downstream.

**Tech Stack:** Same as Phase 1: TypeScript, `@modelcontextprotocol/sdk` (already has a `Client` class that handles stdio JSON-RPC), `node:child_process` (via MCP SDK's `StdioClientTransport`).

**Branch:** `phase2-forwarding`

---

## File Structure

```
packages/core/src/
├── downstream/
│   ├── types.ts            # DownstreamServerConfig, AggregatedTool, ToolOwner
│   ├── env-expand.ts       # ${VAR} substitution
│   ├── client.ts           # DownstreamClient: wraps MCP SDK Client
│   └── manager.ts          # DownstreamManager: start, stop, listTools, forward
├── policy/types.ts         # MODIFY: add mcp_servers to AgentGuardConfig
├── proxy/server.ts         # MAJOR REFACTOR: remove meta-tool, use DownstreamManager
└── cli/commands/start.ts   # MODIFY: create DownstreamManager, wire into dispatcher

packages/core/tests/
├── downstream/
│   ├── env-expand.test.ts
│   ├── client.test.ts
│   └── manager.test.ts
├── proxy/server.test.ts    # MODIFY: update for new tools/call flow
└── e2e/
    ├── cli-smoke.test.ts   # MODIFY: smoke test now uses aggregated tools
    └── forwarding.test.ts  # NEW: spawns real filesystem MCP server
```

---

## Task Sequence

1. Branch setup
2. Downstream types + env-expand helper
3. DownstreamClient (MCP Client wrapper)
4. DownstreamManager (lifecycle, aggregation, forwarding)
5. Extend AgentGuardConfig with mcp_servers
6. Refactor ProxyDispatcher handleToolCall signature (remove meta-tool coupling)
7. Refactor proxy/server.ts MCP server to use DownstreamManager
8. Wire into cli/commands/start.ts
9. Update Phase 1 cli-smoke test
10. Write E2E forwarding test with real filesystem server
11. Manual smoke + merge

---

## Task 1: Branch setup

- [ ] **Step 1:**
  ```bash
  cd /Users/vinh.hoang/github/agentguard
  git checkout main && git pull origin main
  git checkout -b phase2-forwarding
  ```

- [ ] **Step 2:** Verify baseline
  ```bash
  cd packages/core && pnpm test
  ```
  Expected: 105 tests pass.

- [ ] **Step 3:** Commit plan docs
  ```bash
  cd /Users/vinh.hoang/github/agentguard
  git add docs/specs/2026-04-10-phase2-transparent-forwarding.md docs/plans/2026-04-10-phase2-transparent-forwarding.md
  git commit -m "docs: add Phase 2 spec and plan (transparent MCP forwarding)"
  ```

---

## Task 2: Downstream types + env-expand

### Files
- Create: `packages/core/src/downstream/types.ts`
- Create: `packages/core/src/downstream/env-expand.ts`
- Create: `packages/core/tests/downstream/env-expand.test.ts`

- [ ] **Step 1:** Create `packages/core/src/downstream/types.ts`:

```ts
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
```

- [ ] **Step 2:** Write failing test `packages/core/tests/downstream/env-expand.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { expandEnv, expandEnvInConfig } from "../../src/downstream/env-expand.js";

describe("expandEnv", () => {
  it("replaces simple ${VAR} references", () => {
    expect(expandEnv("hello ${USER}", { USER: "vinh" })).toBe("hello vinh");
  });

  it("replaces multiple references in one string", () => {
    expect(expandEnv("${A}-${B}", { A: "x", B: "y" })).toBe("x-y");
  });

  it("returns empty string for missing vars", () => {
    expect(expandEnv("${MISSING}", {})).toBe("");
  });

  it("leaves strings without ${...} unchanged", () => {
    expect(expandEnv("plain text", { USER: "vinh" })).toBe("plain text");
  });
});

describe("expandEnvInConfig", () => {
  it("expands nested string fields", () => {
    const config = {
      command: "${CMD}",
      args: ["--user=${USER}"],
      env: { TOKEN: "${API_KEY}" },
    };
    const result = expandEnvInConfig(config, { CMD: "npx", USER: "vinh", API_KEY: "secret" });
    expect(result).toEqual({
      command: "npx",
      args: ["--user=vinh"],
      env: { TOKEN: "secret" },
    });
  });

  it("leaves non-string values unchanged", () => {
    const config = { count: 42, flag: true, name: "${N}" };
    const result = expandEnvInConfig(config, { N: "hello" });
    expect(result).toEqual({ count: 42, flag: true, name: "hello" });
  });
});
```

- [ ] **Step 3:** Run test — should fail
  ```bash
  cd packages/core && pnpm test tests/downstream/env-expand.test.ts
  ```

- [ ] **Step 4:** Implement `packages/core/src/downstream/env-expand.ts`:

```ts
export function expandEnv(
  value: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string {
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name) => {
    const v = env[name];
    return v ?? "";
  });
}

export function expandEnvInConfig<T>(
  config: T,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): T {
  if (typeof config === "string") {
    return expandEnv(config, env) as unknown as T;
  }
  if (Array.isArray(config)) {
    return config.map((item) => expandEnvInConfig(item, env)) as unknown as T;
  }
  if (config && typeof config === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(config)) {
      result[k] = expandEnvInConfig(v, env);
    }
    return result as T;
  }
  return config;
}
```

- [ ] **Step 5:** Run tests — should pass (6 tests)
  ```bash
  cd packages/core && pnpm test tests/downstream/env-expand.test.ts
  ```

- [ ] **Step 6:** Run full suite
  ```bash
  cd packages/core && pnpm test
  ```
  Expected: 111 tests pass (105 + 6).

- [ ] **Step 7:** Commit
  ```bash
  git add packages/core/src/downstream/types.ts packages/core/src/downstream/env-expand.ts packages/core/tests/downstream/env-expand.test.ts
  git commit -m "feat(downstream): add config types and env-var expansion helper"
  ```

---

## Task 3: DownstreamClient (MCP SDK Client wrapper)

### Files
- Create: `packages/core/src/downstream/client.ts`
- Create: `packages/core/tests/downstream/client.test.ts`

The `DownstreamClient` wraps MCP SDK's `Client` class with stdio transport. It's thin — its main responsibility is to spawn + connect + cache the tool list + forward tool calls.

- [ ] **Step 1:** Write failing test `packages/core/tests/downstream/client.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DownstreamClient } from "../../src/downstream/client.js";

// These tests use a tiny mock MCP server written inline — a Node script that
// speaks MCP stdio and exposes a single "echo" tool. The test file writes it to
// a tempfile and spawns it.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MOCK_SERVER = `#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "mock-echo", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Echoes its input",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    },
    {
      name: "fail",
      description: "Always throws",
      inputSchema: { type: "object" },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "echo") {
    return { content: [{ type: "text", text: String(request.params.arguments.message) }] };
  }
  if (request.params.name === "fail") {
    throw new Error("intentional failure");
  }
  throw new Error("unknown tool");
});

await server.connect(new StdioServerTransport());
`;

describe("DownstreamClient", () => {
  let dir: string;
  let serverPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-dsclient-"));
    serverPath = join(dir, "mock-server.mjs");
    writeFileSync(serverPath, MOCK_SERVER, { mode: 0o755 });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("spawns a downstream MCP server and lists its tools", async () => {
    const client = new DownstreamClient("mock", {
      command: "node",
      args: [serverPath],
    });
    await client.start();
    const tools = client.listTools();
    expect(tools.map((t) => t.originalName).sort()).toEqual(["echo", "fail"]);
    await client.stop();
  });

  it("forwards a tool call and returns the result", async () => {
    const client = new DownstreamClient("mock", {
      command: "node",
      args: [serverPath],
    });
    await client.start();
    const result = await client.callTool("echo", { message: "hello world" });
    expect(result).toBeDefined();
    await client.stop();
  });

  it("propagates downstream errors", async () => {
    const client = new DownstreamClient("mock", {
      command: "node",
      args: [serverPath],
    });
    await client.start();
    await expect(client.callTool("fail", {})).rejects.toThrow();
    await client.stop();
  });

  it("isAlive reports true after start, false after stop", async () => {
    const client = new DownstreamClient("mock", {
      command: "node",
      args: [serverPath],
    });
    expect(client.isAlive()).toBe(false);
    await client.start();
    expect(client.isAlive()).toBe(true);
    await client.stop();
    expect(client.isAlive()).toBe(false);
  });
});
```

- [ ] **Step 2:** Run test — should fail
  ```bash
  cd packages/core && pnpm test tests/downstream/client.test.ts
  ```

- [ ] **Step 3:** Implement `packages/core/src/downstream/client.ts`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  DownstreamServerConfig,
  AggregatedTool,
} from "./types.js";
import { expandEnvInConfig } from "./env-expand.js";

/**
 * A single downstream MCP server under AgentGuard's management.
 * Spawns the configured child process, maintains an MCP Client,
 * caches the tool list, and forwards callTool requests.
 */
export class DownstreamClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: AggregatedTool[] = [];
  private alive = false;

  constructor(
    public readonly name: string,
    private config: DownstreamServerConfig
  ) {}

  async start(): Promise<void> {
    const expandedConfig = expandEnvInConfig(this.config, {
      ...(process.env as Record<string, string | undefined>),
      ...(this.config.env ?? {}),
    });

    this.transport = new StdioClientTransport({
      command: expandedConfig.command,
      args: expandedConfig.args ?? [],
      env: expandedConfig.env as Record<string, string> | undefined,
    });

    this.client = new Client(
      { name: "agentguard-downstream-client", version: "0.1.0" },
      { capabilities: {} }
    );

    await this.client.connect(this.transport);
    this.alive = true;

    const result = await this.client.listTools();
    this.tools = result.tools.map((t) => ({
      name: t.name,                    // will be re-namespaced by manager
      originalName: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      server: this.name,
    }));
  }

  async stop(): Promise<void> {
    this.alive = false;
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // ignore
      }
      this.client = null;
    }
    this.transport = null;
    this.tools = [];
  }

  isAlive(): boolean {
    return this.alive;
  }

  listTools(): AggregatedTool[] {
    return this.tools.slice();
  }

  async callTool(originalName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client || !this.alive) {
      throw new Error(`Downstream ${this.name} is not alive`);
    }
    return await this.client.callTool({
      name: originalName,
      arguments: args,
    });
  }
}
```

- [ ] **Step 4:** Run tests — should pass
  ```bash
  cd packages/core && pnpm test tests/downstream/client.test.ts
  ```
  Expected: 4 tests pass.

- [ ] **Step 5:** Run full suite
  ```bash
  cd packages/core && pnpm test
  ```
  Expected: 115 tests.

- [ ] **Step 6:** Commit
  ```bash
  git add packages/core/src/downstream/client.ts packages/core/tests/downstream/client.test.ts
  git commit -m "feat(downstream): add DownstreamClient wrapping MCP SDK stdio client"
  ```

---

## Task 4: DownstreamManager

### Files
- Create: `packages/core/src/downstream/manager.ts`
- Create: `packages/core/tests/downstream/manager.test.ts`

- [ ] **Step 1:** Write failing test `packages/core/tests/downstream/manager.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DownstreamManager } from "../../src/downstream/manager.js";

const MOCK_SERVER_A = `#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "mock-a", version: "0.0.1" },
  { capabilities: { tools: {} } }
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "read", description: "A read", inputSchema: { type: "object" } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [{ type: "text", text: "a:" + req.params.name }],
}));
await server.connect(new StdioServerTransport());
`;

const MOCK_SERVER_B = `#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "mock-b", version: "0.0.1" },
  { capabilities: { tools: {} } }
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "read", description: "B read (colliding name)", inputSchema: { type: "object" } },
    { name: "write", description: "B write", inputSchema: { type: "object" } },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [{ type: "text", text: "b:" + req.params.name }],
}));
await server.connect(new StdioServerTransport());
`;

describe("DownstreamManager", () => {
  let dir: string;
  let aPath: string;
  let bPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-dmgr-"));
    aPath = join(dir, "a.mjs");
    bPath = join(dir, "b.mjs");
    writeFileSync(aPath, MOCK_SERVER_A);
    writeFileSync(bPath, MOCK_SERVER_B);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts a single downstream and lists its tools without namespacing", async () => {
    const mgr = new DownstreamManager({
      alpha: { command: "node", args: [aPath] },
    });
    await mgr.start();
    const tools = mgr.listTools();
    expect(tools.map((t) => t.name)).toEqual(["read"]);
    await mgr.stop();
  });

  it("auto-namespaces colliding tool names across servers", async () => {
    const mgr = new DownstreamManager({
      alpha: { command: "node", args: [aPath] },
      beta: { command: "node", args: [bPath] },
    });
    await mgr.start();
    const tools = mgr.listTools();
    const names = tools.map((t) => t.name).sort();
    // "read" collides between alpha and beta, so both servers get prefixed.
    // "write" only exists in beta but because beta was affected, it is also prefixed.
    expect(names).toContain("alpha/read");
    expect(names).toContain("beta/read");
    expect(names).toContain("beta/write");
    await mgr.stop();
  });

  it("findTool resolves a namespaced name back to owner", async () => {
    const mgr = new DownstreamManager({
      alpha: { command: "node", args: [aPath] },
      beta: { command: "node", args: [bPath] },
    });
    await mgr.start();
    const owner = mgr.findTool("beta/write");
    expect(owner).toEqual({ server: "beta", originalName: "write" });
    await mgr.stop();
  });

  it("findTool returns undefined for unknown names", async () => {
    const mgr = new DownstreamManager({
      alpha: { command: "node", args: [aPath] },
    });
    await mgr.start();
    expect(mgr.findTool("missing")).toBeUndefined();
    await mgr.stop();
  });

  it("forwards a call to the correct downstream", async () => {
    const mgr = new DownstreamManager({
      alpha: { command: "node", args: [aPath] },
      beta: { command: "node", args: [bPath] },
    });
    await mgr.start();
    const result = await mgr.forward("beta", "write", {});
    expect(JSON.stringify(result)).toContain("b:write");
    await mgr.stop();
  });

  it("surface status: alive count + per-server toolCount", async () => {
    const mgr = new DownstreamManager({
      alpha: { command: "node", args: [aPath] },
    });
    await mgr.start();
    const status = mgr.status();
    expect(status).toHaveLength(1);
    expect(status[0].alive).toBe(true);
    expect(status[0].toolCount).toBe(1);
    await mgr.stop();
  });

  it("namespace override forces prefix even without collisions", async () => {
    const mgr = new DownstreamManager({
      alpha: { command: "node", args: [aPath], namespace: "fs" },
    });
    await mgr.start();
    const tools = mgr.listTools();
    expect(tools[0].name).toBe("fs/read");
    await mgr.stop();
  });

  it("a failing server does not prevent others from starting", async () => {
    const mgr = new DownstreamManager({
      broken: { command: "nonexistent-binary-xyz" },
      alpha: { command: "node", args: [aPath] },
    });
    await mgr.start();
    const tools = mgr.listTools();
    // alpha should still be there; broken should not
    expect(tools.some((t) => t.originalName === "read")).toBe(true);
    const status = mgr.status();
    const broken = status.find((s) => s.name === "broken");
    expect(broken?.alive).toBe(false);
    expect(broken?.error).toBeDefined();
    await mgr.stop();
  });
});
```

- [ ] **Step 2:** Run test — should fail
  ```bash
  cd packages/core && pnpm test tests/downstream/manager.test.ts
  ```

- [ ] **Step 3:** Implement `packages/core/src/downstream/manager.ts`:

```ts
import { DownstreamClient } from "./client.js";
import type {
  DownstreamServerConfig,
  AggregatedTool,
  ToolOwner,
  DownstreamServerStatus,
} from "./types.js";

export class DownstreamManager {
  private clients: Map<string, DownstreamClient> = new Map();
  private errors: Map<string, string> = new Map();
  private tools: AggregatedTool[] = [];
  private ownerIndex: Map<string, ToolOwner> = new Map();

  constructor(private configs: Record<string, DownstreamServerConfig>) {}

  async start(): Promise<void> {
    // Spawn all servers in parallel; isolate failures per server.
    const entries = Object.entries(this.configs);
    await Promise.all(
      entries.map(async ([name, config]) => {
        const client = new DownstreamClient(name, config);
        try {
          await client.start();
          this.clients.set(name, client);
        } catch (err) {
          this.errors.set(name, (err as Error).message);
        }
      })
    );

    this.rebuildToolIndex();
  }

  async stop(): Promise<void> {
    await Promise.all(
      Array.from(this.clients.values()).map((c) => c.stop().catch(() => {}))
    );
    this.clients.clear();
    this.errors.clear();
    this.tools = [];
    this.ownerIndex.clear();
  }

  listTools(): AggregatedTool[] {
    return this.tools.slice();
  }

  findTool(name: string): ToolOwner | undefined {
    return this.ownerIndex.get(name);
  }

  async forward(
    server: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const client = this.clients.get(server);
    if (!client) {
      throw new Error(`Downstream ${server} is not available`);
    }
    return await client.callTool(toolName, args);
  }

  status(): DownstreamServerStatus[] {
    const all: DownstreamServerStatus[] = [];
    for (const name of Object.keys(this.configs)) {
      const client = this.clients.get(name);
      if (client && client.isAlive()) {
        all.push({ name, alive: true, toolCount: client.listTools().length });
      } else {
        all.push({
          name,
          alive: false,
          toolCount: 0,
          error: this.errors.get(name) ?? "not started",
        });
      }
    }
    return all;
  }

  private rebuildToolIndex(): void {
    this.tools = [];
    this.ownerIndex.clear();

    // First pass: collect (server, originalName) pairs
    const toolsByServer = new Map<string, string[]>();
    for (const [name, client] of this.clients.entries()) {
      toolsByServer.set(name, client.listTools().map((t) => t.originalName));
    }

    // Detect collisions (any tool name appearing in 2+ servers)
    const nameCounts = new Map<string, number>();
    for (const names of toolsByServer.values()) {
      for (const n of names) {
        nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
      }
    }
    const colliding = new Set(
      Array.from(nameCounts.entries()).filter(([, c]) => c > 1).map(([n]) => n)
    );

    // Any server that hosts a colliding tool gets ALL its tools prefixed
    const serversNeedingPrefix = new Set<string>();
    for (const [server, names] of toolsByServer.entries()) {
      const cfg = this.configs[server];
      if (cfg?.namespace) {
        serversNeedingPrefix.add(server);
        continue;
      }
      if (names.some((n) => colliding.has(n))) {
        serversNeedingPrefix.add(server);
      }
    }

    // Second pass: build the public tool list with appropriate prefixes
    for (const [server, client] of this.clients.entries()) {
      const cfg = this.configs[server];
      const prefix = cfg?.namespace
        ? `${cfg.namespace}/`
        : serversNeedingPrefix.has(server)
        ? `${server}/`
        : "";

      for (const tool of client.listTools()) {
        const publicName = prefix + tool.originalName;
        const aggregated: AggregatedTool = {
          name: publicName,
          originalName: tool.originalName,
          description: tool.description,
          inputSchema: tool.inputSchema,
          server,
        };
        this.tools.push(aggregated);
        this.ownerIndex.set(publicName, { server, originalName: tool.originalName });
      }
    }
  }
}
```

- [ ] **Step 4:** Run tests — should pass (8 tests)
  ```bash
  cd packages/core && pnpm test tests/downstream/manager.test.ts
  ```

- [ ] **Step 5:** Run full suite
  ```bash
  cd packages/core && pnpm test
  ```
  Expected: 123 tests.

- [ ] **Step 6:** Commit
  ```bash
  git add packages/core/src/downstream/manager.ts packages/core/tests/downstream/manager.test.ts
  git commit -m "feat(downstream): add DownstreamManager with namespacing and failure isolation"
  ```

---

## Task 5: Extend AgentGuardConfig

### File
- Modify: `packages/core/src/policy/types.ts`

- [ ] **Step 1:** Add to `packages/core/src/policy/types.ts`. At the top, add the import (adjust path as needed):

```ts
import type { DownstreamServerConfig } from "../downstream/types.js";
```

Then extend `AgentGuardConfig`:

```ts
export interface AgentGuardConfig {
  budget?: BudgetConfig;
  rules?: Rule[];
  approval?: ApprovalConfig;
  mcp_servers?: Record<string, DownstreamServerConfig>;  // NEW
}
```

- [ ] **Step 2:** Run full test suite — should still pass
  ```bash
  cd packages/core && pnpm test
  ```

- [ ] **Step 3:** Commit
  ```bash
  git add packages/core/src/policy/types.ts
  git commit -m "feat(policy): add mcp_servers block to AgentGuardConfig"
  ```

---

## Task 6: Refactor proxy MCP server to use DownstreamManager

This is the biggest task — it replaces the meta-tool handler with proper `tools/list` aggregation and `tools/call` routing. The existing `ProxyDispatcher` logic stays but `handleToolCall` is called with real tool names now.

### Files
- Modify: `packages/core/src/proxy/server.ts`
- Modify: `packages/core/tests/proxy/server.test.ts` (tests are compatible — no removal of existing tests)

### Plan

The `ProxyDispatcher` class already handles `ToolCallRequest` with `tool`, `args`, `estimatedCost`, etc. — no changes needed there. We keep all existing tests passing.

What changes is the MCP server layer (`start.ts`) that actually registers MCP handlers — but for clarity, we move that MCP server wiring out of `start.ts` and into a new function in `proxy/server.ts`.

- [ ] **Step 1:** Add a new exported function `createMcpServer` in `packages/core/src/proxy/server.ts`. Keep the existing `ProxyDispatcher` class. Add at the bottom of the file:

```ts
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { DownstreamManager } from "../downstream/manager.js";
import type { InstanceTracker } from "../identity/instances.js";

export interface McpServerDeps {
  dispatcher: ProxyDispatcher;
  downstream: DownstreamManager;
  instances: InstanceTracker;
}

/**
 * Creates the MCP stdio Server that external clients (OpenClaw, Claude Desktop, etc.)
 * connect to. Routes tools/list to the aggregated catalog from DownstreamManager
 * and tools/call through the policy/budget/approval dispatcher.
 */
export function createMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer(
    { name: "agentguard", version: "0.2.0" },
    { capabilities: { tools: {} } }
  );

  let currentInstanceId: string | null = null;
  let currentAgentType = "unknown";

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: deps.downstream.listTools().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema ?? { type: "object" },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const owner = deps.downstream.findTool(name);
    if (!owner) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    // Lazily create an instance for this MCP connection.
    if (!currentInstanceId) {
      const instance = deps.instances.create(currentAgentType);
      currentInstanceId = instance.instanceId;
    }

    const result = await deps.dispatcher.handleToolCall({
      agentType: currentAgentType,
      instanceId: currentInstanceId,
      tool: owner.originalName,       // log with the original name, not prefix
      args: (args as Record<string, unknown>) ?? {},
      estimatedCost: 0,
      mcpServer: owner.server,
    });

    if (result.decision.action !== "allow") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              decision: result.decision.action,
              reason: result.decision.reason,
              enforcement: result.decision.enforcement,
            }),
          },
        ],
        isError: true,
      };
    }

    // Forward the call to the downstream server now that policy approved.
    try {
      const downstreamResult = await deps.downstream.forward(
        owner.server,
        owner.originalName,
        (args as Record<string, unknown>) ?? {}
      );
      return downstreamResult as {
        content: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: `Downstream error: ${(err as Error).message}` },
        ],
        isError: true,
      };
    }
  });

  // Set the agent type based on the connecting client's info
  server.oninitialized = () => {
    // Unfortunately MCP SDK doesn't expose client metadata cleanly here.
    // For Phase 2 we rely on the env var or default to "unknown".
    if (process.env.AGENTGUARD_AGENT) {
      currentAgentType = process.env.AGENTGUARD_AGENT;
    }
  };

  return server;
}
```

- [ ] **Step 2:** Run existing tests — should still pass (we haven't removed anything yet)
  ```bash
  cd packages/core && pnpm test tests/proxy/
  ```
  Expected: all existing proxy tests still pass.

- [ ] **Step 3:** Commit
  ```bash
  git add packages/core/src/proxy/server.ts
  git commit -m "feat(proxy): add createMcpServer wrapping DownstreamManager + dispatcher"
  ```

---

## Task 7: Refactor `agentguard start` to use createMcpServer

### File
- Modify: `packages/core/src/cli/commands/start.ts`

- [ ] **Step 1:** Open `packages/core/src/cli/commands/start.ts` and replace the existing MCP server setup block (the `new Server(...)`, `setRequestHandler` for list/call, and the transport connect calls near the bottom) with a `createMcpServer` call.

Add imports at the top:
```ts
import { DownstreamManager } from "../../downstream/manager.js";
import { createMcpServer } from "../../proxy/server.js";
```

Inside `startCommand`, after creating `dispatcher` and before the current MCP server wiring, add:

```ts
  // Spawn downstream MCP servers
  const downstream = new DownstreamManager(config.mcp_servers ?? {});
  try {
    await downstream.start();
    const status = downstream.status();
    const alive = status.filter((s) => s.alive).length;
    const total = status.length;
    console.error(chalk.gray(`Downstreams: ${alive}/${total} alive`));
    for (const s of status) {
      if (s.alive) {
        console.error(chalk.gray(`  ✓ ${s.name} (${s.toolCount} tools)`));
      } else {
        console.error(chalk.yellow(`  ✗ ${s.name}: ${s.error}`));
      }
    }
  } catch (err) {
    console.error(chalk.yellow(`! Downstream startup failed: ${(err as Error).message}`));
  }
```

REMOVE the existing `new Server(...)`, `setRequestHandler(ListToolsRequestSchema, ...)`, `setRequestHandler(CallToolRequestSchema, ...)`, and the `const transport = new StdioServerTransport(); await server.connect(transport);` block.

REPLACE them with:

```ts
  const mcpServer = createMcpServer({
    dispatcher,
    downstream,
    instances,
  });

  // Announce startup
  console.error(chalk.green("AgentGuard proxy started (stdio transport)"));
  console.error(chalk.gray(`Config: ${getConfigPath()}`));
  console.error(chalk.gray(`Audit: ${getAuditDbPath()}`));
  console.error(chalk.gray(`Registered agents: ${agents.length}`));

  // Shutdown handler
  const shutdown = async () => {
    console.error(chalk.yellow("\nShutting down AgentGuard..."));
    await downstream.stop().catch(() => {});
    await ipcServer.stop().catch(() => {});
    approval.shutdown();
    audit.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Connect MCP stdio transport LAST so all setup errors surface before the protocol handshake
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
```

Remove the old imports that are no longer needed (`Server`, `CallToolRequestSchema`, `ListToolsRequestSchema`, `StdioServerTransport` IF they are no longer used — actually StdioServerTransport is still used, keep that).

- [ ] **Step 2:** Build
  ```bash
  cd packages/core && pnpm build
  ```
  Expected: clean build.

- [ ] **Step 3:** Run full test suite
  ```bash
  cd packages/core && pnpm test
  ```
  Expected: most tests pass, but the `cli-smoke.test.ts` may have issues because it no longer has any tools exposed (no downstreams configured). That's fine — Task 9 will fix it.

- [ ] **Step 4:** Commit
  ```bash
  git add packages/core/src/cli/commands/start.ts
  git commit -m "feat(cli): use createMcpServer and DownstreamManager in agentguard start"
  ```

---

## Task 8: Update cli-smoke test for new tool exposure

The Phase 1 cli-smoke test expected the `agentguard_proxy` meta-tool. With Phase 2 it doesn't exist. Update the smoke test to just verify commands work without relying on a specific tool list.

### File
- Modify: `packages/core/tests/e2e/cli-smoke.test.ts`

- [ ] **Step 1:** Open the file and check what it's currently testing. It's likely testing `init`, `agent add`, `agent list`, `logs`. Those should all still pass since they don't touch the MCP server layer. If there's any test that spawns `start` and expects the meta-tool, remove that assertion.

Since the existing file description says it tests "init → agent add → list → logs", it probably doesn't exercise the MCP layer at all. In that case no changes are needed.

Verify by running:
```bash
cd packages/core && pnpm test tests/e2e/cli-smoke.test.ts
```

If tests pass, skip to Step 2. If tests fail, minimally modify the failing assertions to not depend on `agentguard_proxy`.

- [ ] **Step 2:** Run full suite
  ```bash
  cd packages/core && pnpm test
  ```

- [ ] **Step 3:** Commit (only if any changes were needed)
  ```bash
  git add packages/core/tests/e2e/cli-smoke.test.ts
  git commit -m "test(e2e): update cli-smoke for Phase 2 tool exposure" || echo "no changes"
  ```

---

## Task 9: E2E forwarding test with real filesystem server

### File
- Create: `packages/core/tests/e2e/forwarding.test.ts`

This test spawns the real `@modelcontextprotocol/server-filesystem` as a downstream, starts AgentGuard in front of it, connects an MCP client, and verifies `tools/list` aggregates and `tools/call read_text_file` gets forwarded with policy enforcement.

- [ ] **Step 1:** Write the test:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CLI = "dist/cli/index.js";

async function waitForFile(path: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timeout waiting for ${path}`);
}

describe("E2E forwarding", () => {
  let homeDir: string;
  let workspaceDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "agentguard-home-"));
    workspaceDir = mkdtempSync(join(tmpdir(), "agentguard-workspace-"));
    writeFileSync(join(workspaceDir, "hello.txt"), "hello world");

    env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };

    const configDir = join(homeDir, ".agentguard");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.yaml"),
      `budget:
  per_request: 100

approval:
  timeout: "3s"
  timeout_action: deny

rules:
  - match:
      tool: "*"
    action: allow

mcp_servers:
  filesystem:
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - "${workspaceDir}"
    transport: stdio
`
    );
    writeFileSync(join(configDir, "agents.yaml"), "agents: {}\n");
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("tools/list aggregates downstream filesystem server tools", async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: [CLI, "start"],
      env: env as Record<string, string>,
    });
    const client = new Client({ name: "e2e-fwd", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    // Filesystem server exposes tools like read_text_file, write_file, list_directory, etc.
    expect(names.length).toBeGreaterThan(0);
    expect(names.some((n) => n.includes("read"))).toBe(true);

    await client.close();
  }, 30000);
});
```

- [ ] **Step 2:** Build and run
  ```bash
  cd packages/core && pnpm build
  cd packages/core && pnpm test tests/e2e/forwarding.test.ts
  ```
  Expected: 1 test passes. The test is tagged with a 30s timeout because `npx -y @modelcontextprotocol/server-filesystem` may need to download the package on first run.

  If the test fails because npx can't fetch the package (e.g., offline), that's a valid skip condition — add `.skipIf(process.env.CI === "true" && ...)` if needed, but normally this should work.

- [ ] **Step 3:** Run full suite
  ```bash
  cd packages/core && pnpm test
  ```

- [ ] **Step 4:** Commit
  ```bash
  git add packages/core/tests/e2e/forwarding.test.ts
  git commit -m "test(e2e): add forwarding test with real filesystem MCP server"
  ```

---

## Task 10: Manual smoke + merge

- [ ] **Step 1:** Set up a local test config with the filesystem server
  ```bash
  mkdir -p /tmp/agentguard-demo
  echo "hello from AgentGuard" > /tmp/agentguard-demo/greeting.txt
  ```

- [ ] **Step 2:** Update `~/.agentguard/config.yaml` to add the filesystem downstream:
  ```yaml
  mcp_servers:
    filesystem:
      command: npx
      args:
        - -y
        - "@modelcontextprotocol/server-filesystem"
        - /tmp/agentguard-demo
      transport: stdio
  ```

- [ ] **Step 3:** Start AgentGuard and verify it spawns filesystem:
  ```bash
  cd ~/github/agentguard
  node packages/core/dist/cli/index.js start
  ```
  You should see startup messages including `Downstreams: 1/1 alive ✓ filesystem (N tools)` before MCP stdio takes over.

- [ ] **Step 4:** From another process (or a short test script), connect as an MCP client, call `listTools`, and verify the filesystem tools appear.

- [ ] **Step 5:** Push branch
  ```bash
  cd ~/github/agentguard
  git push -u origin phase2-forwarding
  ```

- [ ] **Step 6:** Merge to main
  ```bash
  git checkout main
  git merge --no-ff phase2-forwarding -m "Merge phase2-forwarding: transparent MCP forwarding

  Phase 2 replaces the meta-tool with a real transparent proxy:
  - DownstreamClient wraps MCP SDK stdio Client
  - DownstreamManager spawns all configured servers, aggregates tools,
    handles namespace collisions, isolates per-server failures
  - createMcpServer exposes tools/list and tools/call via downstream routing
  - agentguard_proxy meta-tool removed
  - AgentGuard now works as a drop-in MCP server for OpenClaw, Claude Desktop,
    Cursor, and any other MCP client
  - E2E test exercises real filesystem MCP server as a downstream"
  git push origin main
  ```

---

## Completion Criteria

Phase 2 is complete when:

1. All 10 tasks committed on `phase2-forwarding`
2. Full test suite passes (105 prior + ~20 new = ~125 tests)
3. `agentguard start` spawns downstream servers from config
4. An MCP client calling `tools/list` gets aggregated downstream tools
5. An MCP client calling `tools/call <tool>` gets policy-enforced forwarding
6. Downstream crashes don't kill AgentGuard
7. E2E test with real filesystem MCP server passes
8. Phase 2 merged to main

After Phase 2, OpenClaw can be configured with AgentGuard as its MCP server entry and transparently use all configured downstreams with full policy enforcement.
