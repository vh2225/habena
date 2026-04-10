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

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "agentguard-home-"));
    env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
    socketPath = join(homeDir, ".agentguard", "agentguard.sock");

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
      tool: gmail_send
    action: require_approval
    reason: "Outbound email"
  - match:
      tool: "*"
    action: allow
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
      name: "agentguard_proxy",
      arguments: {
        agent_type: "openclaw",
        tool_name: "gmail_send",
        tool_args: { to: "bob@example.com" },
        estimated_cost: 0,
      },
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
    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("allow");
    expect(result.isError).toBe(false);

    watcher.end();
    await mcp.close();
  }, 15000);

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
      name: "agentguard_proxy",
      arguments: {
        agent_type: "openclaw",
        tool_name: "gmail_send",
        tool_args: { to: "x" },
        estimated_cost: 0,
      },
    }) as { content?: { text?: string }[]; isError?: boolean };

    const text = result.content?.[0]?.text ?? "";
    expect(text).toContain("deny");
    expect(result.isError).toBe(true);

    await mcp.close();
  }, 10000);
});
