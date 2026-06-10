"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCardSkeleton } from "@/components/ui/skeleton";
import { fmtTime, fmtRelative, decisionKind, isThreat, type DecisionRow } from "@/lib/dashboard";
import type { SpendSummary } from "@/lib/audit";

type Summary = {
  totalDecisions: number;
  allowed: number;
  denied: number;
  approvalPending: number;
  threats?: number;
};
type SummaryResp = { ok: boolean; reason?: string; hint?: string; summary: Summary | null };

const POLL_MS = 5000;

function Stat({ label, value, accent, href }: { label: string; value: number; accent?: string; href: string }) {
  return (
    <Link href={href} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]">
      <Card className="p-4 transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]">
        <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted-foreground)]">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>
          {value.toLocaleString()}
        </div>
      </Card>
    </Link>
  );
}

/** 24×1 sparkline of allowed calls per hour, from the spend summary. */
function ActivitySparkline({ hourly }: { hourly: SpendSummary["hourly"] }) {
  const max = Math.max(1, ...hourly.map((h) => h.calls));
  const all0 = hourly.every((h) => h.calls === 0);
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Activity — last 24h
        </div>
        <Link href="/spend" className="text-[11px] text-[var(--color-muted-foreground)] underline-offset-2 hover:text-[var(--color-fg)] hover:underline">
          spend →
        </Link>
      </div>
      {all0 ? (
        <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">Quiet — no allowed calls in the last 24 hours.</p>
      ) : (
        <div className="mt-3 flex h-12 items-end gap-[3px]" role="img" aria-label="Allowed calls per hour, last 24 hours">
          {hourly.map((h) => (
            <div
              key={h.hourIso}
              title={`${h.calls} calls`}
              className="flex-1 rounded-[2px] bg-[var(--color-accent)]/65"
              style={{ height: `${Math.max(h.calls > 0 ? 10 : 3, Math.round((h.calls / max) * 100))}%` }}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function RecentActivity({ rows }: { rows: DecisionRow[] }) {
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Latest decisions
        </div>
        <Link href="/decisions" className="text-[11px] text-[var(--color-muted-foreground)] underline-offset-2 hover:text-[var(--color-fg)] hover:underline">
          all decisions →
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">
          Nothing yet — start your agent and decisions stream here.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2.5 border-b border-[var(--color-surface-2)] py-1.5 text-xs last:border-b-0">
              <Badge kind={decisionKind(r.decision)}>{r.decision}</Badge>
              {isThreat(r) && <Badge kind="threat" />}
              <span className="truncate font-mono">{r.tool}</span>
              <span className="truncate text-[var(--color-muted-foreground)]">{r.agentType}</span>
              <span className="ml-auto shrink-0 tabular-nums text-[var(--color-muted-foreground)]" title={fmtTime(r.timestamp)}>
                {fmtRelative(r.timestamp)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function Overview() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [recent, setRecent] = useState<DecisionRow[]>([]);
  const [hourly, setHourly] = useState<SpendSummary["hourly"] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = (await fetch("/api/summary", { cache: "no-store" }).then((x) => x.json())) as SummaryResp;
        if (cancelled) return;
        setSum(r.summary);
        setHint(r.ok ? null : r.hint ?? r.reason ?? null);
      } catch (e) {
        if (!cancelled) setHint((e as Error).message);
      }
      try {
        const setup = await fetch("/api/setup-status", { cache: "no-store" }).then((x) => x.json());
        if (!cancelled) setConfigured(Boolean(setup?.configExists));
      } catch {
        /* leave configured as-is on transient failure */
      }
      try {
        const d = await fetch("/api/decisions?limit=8", { cache: "no-store" }).then((x) => x.json());
        if (!cancelled && Array.isArray(d?.rows)) setRecent(d.rows.slice(0, 8));
      } catch {
        /* feed is decorative; stat cards carry the page */
      }
      try {
        const s = await fetch("/api/spend", { cache: "no-store" }).then((x) => x.json());
        if (!cancelled && Array.isArray(s?.spend?.hourly)) setHourly(s.spend.hourly);
      } catch {
        /* sparkline is decorative */
      }
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">Your agents at a glance.</p>
      </header>

      {hint && (
        <div role="status" aria-live="polite" className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-muted-foreground)]">
          {hint}
        </div>
      )}

      {!configured && (
        <a href="/welcome" className="mb-4 block rounded-xl border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 p-4 text-sm">
          <strong>Finish setup</strong> — you haven&apos;t configured Habena yet. <span className="underline">Open the setup wizard →</span>
        </a>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {sum === null && !hint ? (
          Array.from({ length: 5 }, (_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <Stat label="Total decisions" value={sum?.totalDecisions ?? 0} href="/decisions" />
            <Stat label="Allowed" value={sum?.allowed ?? 0} accent="var(--color-allow)" href="/decisions?decision=allow" />
            <Stat label="Denied" value={sum?.denied ?? 0} accent="var(--color-deny)" href="/decisions?decision=deny" />
            <Stat label="Require approval" value={sum?.approvalPending ?? 0} accent="var(--color-warn)" href="/decisions?decision=require_approval" />
            <Stat label="Threat flags" value={sum?.threats ?? 0} accent="var(--color-deny)" href="/threats" />
          </>
        )}
      </section>

      <section className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        {hourly && <ActivitySparkline hourly={hourly} />}
        <RecentActivity rows={recent} />
      </section>
    </main>
  );
}
