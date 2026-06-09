"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtTime } from "@/lib/dashboard";
import type { AgentSummary } from "@/lib/agents";

const POLL_MS = 5000;

type Resp = { agents: AgentSummary[] };

function StatusChip({ status }: { status: AgentSummary["status"] }) {
  if (status === "observed") return <Badge kind="warn">observed · unregistered</Badge>;
  if (status === "idle") return <Badge kind="neutral">idle</Badge>;
  return <Badge kind="allow">registered</Badge>;
}

function AgentCard({ a }: { a: AgentSummary }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm text-[var(--color-fg)]">{a.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
            <StatusChip status={a.status} />
            {a.mode && <span>mode: {a.mode}</span>}
            {a.registered && <span>· registered {a.registered}</span>}
            {a.lastSeen && <span>· last seen {fmtTime(a.lastSeen)}</span>}
          </div>
        </div>
        <a href={`/decisions?agent=${encodeURIComponent(a.name)}`} className="shrink-0 text-xs text-[var(--color-muted-foreground)] underline hover:text-[var(--color-fg)]">
          View decisions →
        </a>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <Badge kind="allow">{a.decisions.allow} allowed</Badge>
        <Badge kind="deny">{a.decisions.deny} denied</Badge>
        <Badge kind="warn">{a.decisions.approval} approval</Badge>
        <span className="text-[var(--color-muted-foreground)]">· {a.instancesSeen} instance{a.instancesSeen === 1 ? "" : "s"} seen</span>
      </div>

      {a.topTools.length > 0 && (
        <div className="mt-2 text-xs text-[var(--color-muted-foreground)]">
          top tools: {a.topTools.map((t) => `${t.tool} (${t.count})`).join(" · ")}
        </div>
      )}

      {a.budgetDaily !== null && (
        <div className="mt-2 text-xs text-[var(--color-muted-foreground)]">Daily budget: ${a.budgetDaily}</div>
      )}
    </Card>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = (await fetch("/api/agents", { cache: "no-store" }).then((x) => x.json())) as Resp;
        if (cancelled) return;
        setAgents(Array.isArray(r.agents) ? r.agents : []);
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Agents</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">Registered agents and what they&apos;ve been doing.</p>
      </header>

      {loaded && agents.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          No agents yet — register one with <code>habena agent add --name &lt;name&gt; --budget-daily &lt;n&gt;</code>, or finish setup in <a href="/welcome" className="underline">the wizard</a>.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {agents.map((a) => <AgentCard key={a.name} a={a} />)}
      </div>
    </main>
  );
}
