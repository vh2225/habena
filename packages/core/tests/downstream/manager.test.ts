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

// A server whose listTools() always succeeds but whose only tool returns
// isError: true — emulates a downstream that starts but is unauthenticated.
const MOCK_SERVER_UNAUTH = `#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "mock-unauth", version: "0.0.1" },
  { capabilities: { tools: {} } }
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "ping", description: "probe", inputSchema: { type: "object" } }],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({
  isError: true,
  content: [{ type: "text", text: "Authentication tokens are no longer valid." }],
}));
await server.connect(new StdioServerTransport());
`;

describe("DownstreamManager", () => {
  let dir: string;
  let aPath: string;
  let bPath: string;
  let unauthPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-dmgr-"));
    aPath = join(dir, "a.mjs");
    bPath = join(dir, "b.mjs");
    unauthPath = join(dir, "unauth.mjs");
    writeFileSync(aPath, MOCK_SERVER_A);
    writeFileSync(bPath, MOCK_SERVER_B);
    writeFileSync(unauthPath, MOCK_SERVER_UNAUTH);
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

  it("authStatus defaults to 'unchecked' when no probe is configured", async () => {
    const mgr = new DownstreamManager({
      alpha: { command: "node", args: [aPath] },
    });
    await mgr.start();
    const status = mgr.status();
    expect(status[0].authStatus).toBe("unchecked");
    expect(status[0].alive).toBe(true);
    await mgr.stop();
  });

  it("authStatus becomes 'authenticated' when the probe call succeeds", async () => {
    const mgr = new DownstreamManager({
      alpha: {
        command: "node",
        args: [aPath],
        auth_probe: { tool: "read" }, // mock returns success
      },
    });
    await mgr.start();
    const status = mgr.status();
    expect(status[0].authStatus).toBe("authenticated");
    expect(status[0].authError).toBeUndefined();
    await mgr.stop();
  });

  it("authStatus becomes 'auth_failed' when the probe returns isError", async () => {
    const mgr = new DownstreamManager({
      broken: {
        command: "node",
        args: [unauthPath],
        auth_probe: { tool: "ping" },
      },
    });
    await mgr.start();
    const status = mgr.status();
    expect(status[0].alive).toBe(true); // process started fine
    expect(status[0].authStatus).toBe("auth_failed");
    expect(status[0].authError).toContain("Authentication tokens");
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
