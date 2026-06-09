import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DownstreamManager } from "../../src/downstream/manager.js";
import { ProxyDispatcher, createMcpServer } from "../../src/proxy/server.js";
import { PolicyEngine } from "../../src/policy/engine.js";
import { CostTracker } from "../../src/cost/tracker.js";
import { BudgetEnforcer } from "../../src/cost/budget.js";
import { AuditLogger } from "../../src/audit/logger.js";
import { InstanceTracker } from "../../src/identity/instances.js";
import { Forwarder } from "../../src/proxy/forwarder.js";

// A real downstream MCP server (same harness style as
// tests/downstream/manager.test.ts) exposing a single `echo` tool that
// returns its `text` argument verbatim. If forwarding works end-to-end the
// proxy must hand back this exact text — never result:null.
const MOCK_ECHO_SERVER = `#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "mock-echo", version: "0.0.1" },
  { capabilities: { tools: {} } }
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "echo", description: "Echoes back its text arg", inputSchema: { type: "object" } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [{ type: "text", text: String(req.params.arguments?.text ?? "") }],
}));
await server.connect(new StdioServerTransport());
`;

describe("proxy end-to-end downstream forwarding", () => {
  let dir: string;
  let echoPath: string;
  let manager: DownstreamManager;
  let audit: AuditLogger;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentguard-fwd-e2e-"));
    echoPath = join(dir, "echo.mjs");
    writeFileSync(echoPath, MOCK_ECHO_SERVER);
  });

  afterEach(async () => {
    if (manager) await manager.stop().catch(() => {});
    if (audit) audit.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("forwards an allowed tools/call through createMcpServer to the real downstream and returns its result", async () => {
    // Real downstream over a spawned child process + real MCP client.
    manager = new DownstreamManager({
      alpha: { command: "node", args: [echoPath] },
    });
    await manager.start();
    expect(manager.findTool("echo")).toEqual({ server: "alpha", originalName: "echo" });

    // Full dispatch chain, wired the same way the `start` command does.
    const policy = new PolicyEngine([{ match: { tool: "echo" }, action: "allow" }]);
    const tracker = new CostTracker();
    const budget = new BudgetEnforcer(tracker, {});
    audit = new AuditLogger(join(dir, "audit.db"));
    const instances = new InstanceTracker();
    const forwarder = new Forwarder();

    const dispatcher = new ProxyDispatcher({
      policy,
      tracker,
      budget,
      audit,
      instances,
      forwarder,
    });

    const server = createMcpServer({ dispatcher, downstream: manager, instances });

    // Drive the registered CallToolRequest handler through a real MCP client
    // over an in-memory transport pair — exercises the live request path.
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities: {} });
    await client.connect(clientTransport);

    try {
      const result = (await client.callTool({
        name: "echo",
        arguments: { text: "hello" },
      })) as { content: Array<{ type: string; text?: string }>; isError?: boolean };

      // The assertion that matters: downstream's actual output came back,
      // proving the call was forwarded and the result returned (not null).
      expect(result.isError).toBeFalsy();
      const text = result.content.find((c) => c.type === "text")?.text;
      expect(text).toBe("hello");
    } finally {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
    }
  });

  it("returns the real downstream result at the DownstreamManager.forward boundary after an allow decision", async () => {
    manager = new DownstreamManager({
      alpha: { command: "node", args: [echoPath] },
    });
    await manager.start();

    const policy = new PolicyEngine([{ match: { tool: "echo" }, action: "allow" }]);
    const tracker = new CostTracker();
    const budget = new BudgetEnforcer(tracker, {});
    audit = new AuditLogger(join(dir, "audit.db"));
    const instances = new InstanceTracker();
    const forwarder = new Forwarder();
    const dispatcher = new ProxyDispatcher({ policy, tracker, budget, audit, instances, forwarder });

    const owner = manager.findTool("echo");
    expect(owner).toBeDefined();

    const decision = await dispatcher.handleToolCall({
      agentType: "test",
      instanceId: "test/1",
      tool: owner!.originalName,
      args: { text: "world" },
      estimatedCost: 0,
      mcpServer: owner!.server,
    });
    expect(decision.decision.action).toBe("allow");

    const forwarded = (await manager.forward(owner!.server, owner!.originalName, {
      text: "world",
    })) as { content: Array<{ type: string; text?: string }> };
    const text = forwarded.content.find((c) => c.type === "text")?.text;
    expect(text).toBe("world");
  });
});
