import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CLI = "dist/cli/index.js";

const MOCK_SEND_SERVER = `#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
const server = new Server({ name: "mock-send", version: "0.0.1" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "risky_send", description: "Sends", inputSchema: { type: "object" } }],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "sent" }] }));
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

describe("E2E approvals forward", () => {
  let homeDir: string;
  let env: NodeJS.ProcessEnv;
  let socketPath: string;
  let mockServerPath: string;
  let webhookServer: Server;
  let webhookPort: number;
  let webhookPosts: Array<{ headers: Record<string, string>; body: unknown }>;

  beforeEach(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "agentguard-forward-"));
    env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
    socketPath = join(homeDir, ".agentguard", "agentguard.sock");

    const configDir = join(homeDir, ".agentguard");
    mkdirSync(configDir, { recursive: true });
    mockServerPath = join(configDir, "mock-send.mjs");
    writeFileSync(mockServerPath, MOCK_SEND_SERVER, { mode: 0o755 });

    writeFileSync(
      join(configDir, "config.yaml"),
      `budget:
  per_request: 100
approval:
  timeout: "5s"
  timeout_action: deny
rules:
  - match:
      tool: risky_send
    action: require_approval
    reason: "test"
  - match:
      tool: "*"
    action: allow
mcp_servers:
  send:
    command: node
    args: ["${mockServerPath}"]
    transport: stdio
`
    );
    writeFileSync(join(configDir, "agents.yaml"), "agents: {}\n");

    // Spin up a local HTTP server to receive webhook POSTs.
    webhookPosts = [];
    webhookServer = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
        try {
          webhookPosts.push({ headers, body: JSON.parse(body) });
        } catch {
          webhookPosts.push({ headers, body });
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => webhookServer.listen(0, "127.0.0.1", () => resolve()));
    const addr = webhookServer.address();
    webhookPort = typeof addr === "object" && addr ? addr.port : 0;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("POSTs approval_request to the configured webhook URL", async () => {
    // Start the proxy
    const mcpTransport = new StdioClientTransport({
      command: "node",
      args: [CLI, "start"],
      env: env as Record<string, string>,
    });
    const mcp = new Client({ name: "e2e-fwd", version: "0.1.0" }, { capabilities: {} });
    await mcp.connect(mcpTransport);
    await waitForFile(socketPath);

    // Start the forwarder subprocess
    const forwarder: ChildProcess = spawn(
      "node",
      [CLI, "approvals", "forward", "--url", `http://127.0.0.1:${webhookPort}/hook`, "--hmac-secret", "s3cret"],
      { env: env as Record<string, string>, stdio: ["pipe", "pipe", "pipe"] }
    );
    // Wait briefly for the forwarder to connect to IPC
    await new Promise((r) => setTimeout(r, 300));

    // Fire a tool call that requires approval
    const callPromise = mcp.callTool({ name: "risky_send", arguments: { to: "bob" } });

    // Wait up to 4s for the webhook to receive the POST
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const poll = () => {
        if (webhookPosts.length > 0) return resolve();
        if (Date.now() - start > 4000) return reject(new Error("webhook didn't receive event"));
        setTimeout(poll, 50);
      };
      poll();
    });

    const post = webhookPosts[0];
    expect(post.body).toMatchObject({
      type: "approval_request",
      pending: expect.objectContaining({ tool: "risky_send" }),
    });
    // Stripe/GitHub-style envelope: t=<unix>,v1=<hex64>
    expect(post.headers["x-agentguard-signature"]).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    expect(post.headers["x-agentguard-timestamp"]).toMatch(/^\d+$/);
    expect(post.headers["user-agent"]).toContain("agentguard-forwarder");

    // Let the tool call time out (deny) so the proxy teardown is clean.
    await callPromise.catch(() => {});
    forwarder.kill("SIGINT");
    await new Promise((r) => setTimeout(r, 200));
    await mcp.close();
  }, 20000);
});
