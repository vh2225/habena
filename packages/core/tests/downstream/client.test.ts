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
