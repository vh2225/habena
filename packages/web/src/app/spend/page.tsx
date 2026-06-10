"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { StatCardSkeleton } from "@/components/ui/skeleton";
import type { SpendSummary } from "@/lib/audit";

type Resp = { ok: boolean; reason?: string; hint?: string; spend: SpendSummary | null };
const POLL_MS = 5000;

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{sub}</div>}
    </Card>
  );
}

function fmtUsd(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;
}

/** Local hour label for a UTC "YYYY-MM-DDTHH" bucket. */
function hourLabel(hourIso: string): string {
  const d = new Date(`${hourIso}:00:00Z`);
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
}

function BreakdownTable({ title, rows }: { title: string; rows: Array<{ name: string; calls: number; cost: number }> }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <div className="text-xs text-[var(--color-muted-foreground)]">No calls today.</div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left uppercase tracking-wide text-[var(--color-muted-foreground)]">
              <th className="pb-1 font-medium">Name</th>
              <th className="pb-1 text-right font-medium">Calls</th>
              <th className="pb-1 text-right font-medium">Declared $</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-[var(--color-surface-2)]">
                <td className="py-1 font-mono">{r.name}</td>
                <td className="py-1 text-right">{r.calls.toLocaleString()}</td>
                <td className="py-1 text-right text-[var(--color-muted-foreground)]">{r.cost > 0 ? fmtUsd(r.cost) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export default function SpendPage() {
  const [spend, setSpend] = useState<SpendSummary | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = (await fetch("/api/spend", { cache: "no-store" }).then((x) => x.json())) as Resp;
        if (cancelled) return;
        setSpend(r.spend);
        setHint(r.ok ? null : r.hint ?? r.reason ?? null);
      } catch (e) {
        if (!cancelled) setHint((e as Error).message);
      }
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const maxHourCalls = Math.max(1, ...(spend?.hourly.map((h) => h.calls) ?? [1]));

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Spend</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Call volume and declared-pricing dollars. Dollar figures come from the <code>pricing:</code> block
          in <code>config.yaml</code> — they are your declared per-call prices, not measured LLM spend.
        </p>
      </header>

      {hint && (
        <div role="status" aria-live="polite" className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-muted-foreground)]">
          {hint}
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {spend === null && !hint ? (
          Array.from({ length: 4 }, (_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
        <Stat label="Calls today" value={(spend?.callsToday ?? 0).toLocaleString()} />
        <Stat label="Calls last hour" value={(spend?.callsLastHour ?? 0).toLocaleString()} />
        <Stat
          label="Result tokens today"
          value={`~${(spend?.resultTokensToday ?? 0).toLocaleString()}`}
          sub="est. tokens of tool results fed to agents"
        />
        <Stat
          label="Declared spend today"
          value={fmtUsd(spend?.costToday ?? 0)}
          sub={spend && spend.costToday === 0 ? "no priced tools called — see pricing: in config" : undefined}
        />
          </>
        )}
      </section>

      <Card className="mt-3 p-4">
        <h2 className="mb-3 text-sm font-semibold">Calls per hour — last 24h</h2>
        {spend && spend.hourly.every((h) => h.calls === 0) ? (
          <div className="text-xs text-[var(--color-muted-foreground)]">No calls in the last 24 hours — start your agent and activity shows up here.</div>
        ) : (
          <div className="flex h-24 items-end gap-1" role="img" aria-label="Calls per hour over the last 24 hours">
            {(spend?.hourly ?? []).map((h) => (
              <div key={h.hourIso} className="flex flex-1 flex-col items-center gap-1" title={`${hourLabel(h.hourIso)}: ${h.calls} calls${h.cost > 0 ? `, ${fmtUsd(h.cost)}` : ""}`}>
                <div
                  className="w-full rounded-sm bg-[var(--color-accent)]/70"
                  style={{ height: `${Math.max(h.calls > 0 ? 6 : 1, Math.round((h.calls / maxHourCalls) * 80))}px` }}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      <section className="mt-3 grid gap-3 sm:grid-cols-2">
        <BreakdownTable title="By agent (today)" rows={(spend?.byAgent ?? []).map((a) => ({ name: a.agentType, calls: a.calls, cost: a.cost }))} />
        <BreakdownTable title="By tool (today)" rows={(spend?.byTool ?? []).map((t) => ({ name: t.tool, calls: t.calls, cost: t.cost }))} />
      </section>

      <p className="mt-6 text-xs text-[var(--color-muted-foreground)]">
        Enforcement happens in the proxy: call-rate and result-size limits hard-deny; dollar overruns follow{" "}
        <code>budget.on_exceed</code>. Hits show up as denials in <a href="/decisions?decision=deny" className="underline hover:text-[var(--color-fg)]">Decisions</a>.
      </p>
    </main>
  );
}
