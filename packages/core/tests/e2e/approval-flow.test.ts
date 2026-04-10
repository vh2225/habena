import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { encode, decodeLines, type ServerMessage } from "../../src/ipc/protocol.js";

const CLI = "dist/cli/index.js";

// Inline mock MCP server that exposes a single "gmail_send" tool.
const MOCK_GMAIL_SERVER = `#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "mock-gmail", version: "0.0.1" },
  { capabilities: { tools: {} } }
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "gmail_send", description: "Sends email", inputSchema: { type: "object" } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [{ type: "text", text: "sent" }],
}));
await server.connect(new StdioServerTransport());
`;

async function waitForFile(path: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timeout waiting for ${path}`);
}

describe("E2E approval flow", () => {
  let homeDir: string;
  let env: NodeJS.ProcessEnv;
  let socketPath: string;
  let mockServerPath: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "agentguard-home-"));
    env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
    socketPath = join(homeDir, ".agentguard", "agentguard.sock");

    const configDir = join(homeDir, ".agentguard");
    mkdirSync(configDir, { recursive: true });

    // Write the mock gmail server script
    mockServerPath = join(configDir, "mock-gmail.mjs");
    writeFileSync(mockServerPath, MOCK_GMAIL_SERVER, { mode: 0o755 });

    writeFileSync(
      join(configDir, "config.yaml"),
      `budget:
  per_request: 100
approval:
  timeout: "3s"
  timeout_action: deny
rules:
  - match:
      tool: gmail_send
    action: require_approval
    reason: "Outbound email"
  - match:
      tool: "*"
    action: allow
mcp_servers:
  gmail:
    command: node
    args: ["${mockServerPath}"]
    transport: stdio
`
    );
    writeFileSync(join(configDir, "agents.yaml"), "agents: {}\n");
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("agent tool call triggering approval → human allows → agent sees allow", async () => {
    const mcpTransport = new StdioClientTransport({
      command: "node",
      args: [CLI, "start"],
      env: env as Record<string, string>,
    });
    const mcp = new Client({ name: "e2e-test", version: "0.1.0" }, { capabilities: {} });
    await mcp.connect(mcpTransport);

    await waitForFile(socketPath);

    const watcher: Socket = createConnection(socketPath);
    await new Promise<void>((resolve, reject) => {
      watcher.once("connect", resolve);
      watcher.once("error", reject);
    });

    let buffer = "";
    const messages: ServerMessage[] = [];
    watcher.on("data", (chunk) => {
      buffer += chunk.toString();
      const { messages: parsed, remainder } = decodeLines(buffer);
      buffer = remainder;
      for (const m of parsed) messages.push(m as ServerMessage);
    });

    await new Promise<void>((resolve) => {
      const check = () => {
        if (messages.some((m) => m.type === "hello")) return resolve();
        setTimeout(check, 20);
      };
      check();
    });

    const callPromise = mcp.callTool({
      name: "gmail_send",
      arguments: { to: "bob@example.com" },
    });

    await new Promise<void>((resolve) => {
      const check = () => {
        if (messages.some((m) => m.type === "approval_request")) return resolve();
        setTimeout(check, 20);
      };
      check();
    });

    const req = messages.find((m) => m.type === "approval_request")!;
    if (req.type !== "approval_request") throw new Error("unreachable");

    watcher.write(encode({ type: "respond", id: req.id, choice: "allow_once" }));

    const result = await callPromise as { content?: { text?: string }[]; isError?: boolean };
    // On allow, the downstream mock returns { content: [{ type: "text", text: "sent" }] }
    expect(result.isError).not.toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toBe("sent");

    watcher.end();
    await mcp.close();
  }, 20000);

  it("agent tool call with no watcher → timeout → auto-deny", async () => {
    const mcpTransport = new StdioClientTransport({
      command: "node",
      args: [CLI, "start"],
      env: env as Record<string, string>,
    });
    const mcp = new Client({ name: "e2e-test-2", version: "0.1.0" }, { capabilities: {} });
    await mcp.connect(mcpTransport);
    await waitForFile(socketPath);

    const result = await mcp.callTool({
      name: "gmail_send",
      arguments: { to: "x" },
    }) as { content?: { text?: string }[]; isError?: boolean };

    // On deny, isError is true and content text is JSON with decision field
    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    const parsed = JSON.parse(text) as { decision: string };
    expect(parsed.decision).toContain("deny");

    await mcp.close();
  }, 15000);
});
