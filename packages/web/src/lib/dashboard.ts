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

/** Compact relative time for live feeds: "just now", "42s ago", "5m ago", "3h ago", "2d ago". */
export function fmtRelative(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const s = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** Pretty-print a JSON-text args preview; falls back to the raw text. */
export function prettyArgs(raw: string | null): string {
  if (!raw) return "—";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw; // truncated previews won't parse — show as-is
  }
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
