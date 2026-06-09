// CLIENT-SAFE: no node/server imports. Shared types + pure merge logic.

export interface RegistryAgent {
  name: string;
  mode: string;
  registered: string;
  fingerprint: string;
  budgetDaily: number | null;
}

export interface AgentActivity {
  agentType: string;
  total: number;
  allow: number;
  deny: number;
  approval: number;
  topTools: { tool: string; count: number }[];
  instancesSeen: number;
  lastSeen: string | null;
}

export type AgentStatus = "registered" | "idle" | "observed";

export interface AgentSummary {
  name: string;
  status: AgentStatus;
  mode: string | null;
  registered: string | null;
  fingerprint: string | null;
  budgetDaily: number | null;
  decisions: { total: number; allow: number; deny: number; approval: number };
  topTools: { tool: string; count: number }[];
  instancesSeen: number;
  lastSeen: string | null;
}

const ZERO = { total: 0, allow: 0, deny: 0, approval: 0 };

export function mergeAgents(registry: RegistryAgent[], activity: AgentActivity[]): AgentSummary[] {
  const byType = new Map(activity.map((a) => [a.agentType, a]));
  const seen = new Set<string>();
  const out: AgentSummary[] = [];

  for (const r of registry) {
    seen.add(r.name);
    const a = byType.get(r.name);
    out.push({
      name: r.name,
      status: a && a.total > 0 ? "registered" : "idle",
      mode: r.mode,
      registered: r.registered,
      fingerprint: r.fingerprint,
      budgetDaily: r.budgetDaily,
      decisions: a ? { total: a.total, allow: a.allow, deny: a.deny, approval: a.approval } : { ...ZERO },
      topTools: a?.topTools ?? [],
      instancesSeen: a?.instancesSeen ?? 0,
      lastSeen: a?.lastSeen ?? null,
    });
  }

  for (const a of activity) {
    if (seen.has(a.agentType)) continue;
    out.push({
      name: a.agentType,
      status: "observed",
      mode: null,
      registered: null,
      fingerprint: null,
      budgetDaily: null,
      decisions: { total: a.total, allow: a.allow, deny: a.deny, approval: a.approval },
      topTools: a.topTools,
      instancesSeen: a.instancesSeen,
      lastSeen: a.lastSeen,
    });
  }

  return out.sort((x, y) => y.decisions.total - x.decisions.total || x.name.localeCompare(y.name));
}
