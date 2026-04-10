import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CLI = "dist/cli/index.js";

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
    // Use JS template literal so workspaceDir is interpolated into YAML
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
      - "-y"
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
    expect(names.length).toBeGreaterThan(0);
    expect(names.some((n) => n.toLowerCase().includes("read") || n.toLowerCase().includes("list"))).toBe(true);

    await client.close();
  }, 60000);
});
