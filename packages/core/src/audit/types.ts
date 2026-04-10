export interface AuditEntry {
  timestamp: Date;
  agentType: string;
  instanceId: string;
  tool: string;
  args: Record<string, unknown>;
  mcpServer: string;
  decision: "allow" | "deny" | "require_approval";
  tier: "built_in" | "user" | "session";
  ruleMatched?: string;
  reason?: string;
  cost: number | null;
  latencyMs: number | null;
  resultStatus: "success" | "error" | "timeout" | "pending";
}

export interface AuditQueryFilters {
  agentType?: string;
  instanceId?: string;
  since?: Date;
  decision?: "allow" | "deny" | "require_approval";
  limit?: number;
}
