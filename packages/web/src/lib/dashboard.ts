// Single source of truth: re-export the canonical DecisionRow from the audit
// reader. `import type` is erased at compile (isolatedModules), so this does NOT
// pull better-sqlite3 (audit.ts's runtime dep) into the client bundle.
import type { DecisionRow } from "./audit";
export type { DecisionRow };

export interface DecisionFilters {
  agentType: string;
  decision: string;
  mcpServer: string;
  threatsOnly: boolean;
}

export function fmtTime(iso: string, now: Date = new Date()): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) return d.toLocaleTimeString();
    return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString()}`;
  } catch {
    return iso;
  }
}

/**
 * Threat-engine decisions carry a `threat:<detector>: …` reason (see core
 * threat/engine.ts). Substring match, not prefix: the approval flow prefixes
 * resolved reasons ("approved: threat:…", "denied: threat:…").
 */
export function isThreat(row: Pick<DecisionRow, "reason">): boolean {
  return (row.reason ?? "").includes("threat:");
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
  if (f.threatsOnly && !isThreat(row)) return false;
  return true;
}

/** Decision → Badge kind, shared by the table and the drawer. */
export function decisionKind(decision: string): "allow" | "deny" | "warn" | "neutral" {
  if (decision === "allow") return "allow";
  if (decision === "deny") return "deny";
  if (decision === "require_approval") return "warn";
  return "neutral";
}
