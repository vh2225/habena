/**
 * MCP server that agents connect to.
 * Receives tool calls from agents, passes them through the policy engine,
 * then forwards allowed calls to downstream MCP servers via forwarder.
 */

import { PolicyEngine } from "../policy/engine.js";
import { CostTracker } from "../cost/tracker.js";
import { ApprovalQueue } from "../approval/queue.js";
import { AuditLogger } from "../audit/logger.js";

export interface ProxyServerOptions {
  configPath: string;
  mode: "stdio" | "http";
  httpPort?: number;
}

export class ProxyServer {
  private policy: PolicyEngine;
  private cost: CostTracker;
  private approvals: ApprovalQueue;
  private audit: AuditLogger;

  constructor(options: ProxyServerOptions) {
    this.policy = new PolicyEngine(options.configPath);
    this.cost = new CostTracker(options.configPath);
    this.approvals = new ApprovalQueue();
    this.audit = new AuditLogger();
  }

  async start(): Promise<void> {
    // TODO: Initialize MCP server, register tool handlers
  }

  async stop(): Promise<void> {
    // TODO: Graceful shutdown
  }
}
