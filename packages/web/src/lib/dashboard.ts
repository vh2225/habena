export interface DecisionRow {
  id: number;
  timestamp: string;
  agentType: string;
  instanceId: string;
  tool: string;
  mcpServer: string;
  decision: string;
  tier: string;
  ruleMatched: string | null;
  reason: string | null;
  latencyMs: number | null;
  resultStatus: string;
}

export interface DecisionFilters {
  agentType: string;
  decision: string;
  mcpServer: string;
}

export function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString();
  } catch {
    return iso;
  }
}

export function fmtLatency(ms: number | null): string {
  return ms !== null && ms !== undefined ? `${ms}ms` : "—";
}

export function uniqueValues<K extends keyof DecisionRow>(rows: DecisionRow[], key: K): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "string" && v) set.add(v);
  }
  return Array.from(set).sort();
}

export function matchesFilters(row: DecisionRow, f: DecisionFilters): boolean {
  if (f.agentType && row.agentType !== f.agentType) return false;
  if (f.decision && row.decision !== f.decision) return false;
  if (f.mcpServer && row.mcpServer !== f.mcpServer) return false;
  return true;
}

/** Decision → Badge kind, shared by the table and the drawer. */
export function decisionKind(decision: string): "allow" | "deny" | "warn" | "neutral" {
  if (decision === "allow") return "allow";
  if (decision === "deny") return "deny";
  if (decision === "require_approval") return "warn";
  return "neutral";
}
