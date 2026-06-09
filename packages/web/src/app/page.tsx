"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";

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
    <Link href={href} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]">
      <Card className="p-4 transition hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-2)]">
        <div className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">{label}</div>
        <div className="mt-1 text-2xl font-semibold" style={accent ? { color: accent } : undefined}>
          {value.toLocaleString()}
        </div>
      </Card>
    </Link>
  );
}

export default function Overview() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);

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
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">Your agents at a glance.</p>
      </header>

      {hint && (
        <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-muted-foreground)]">
          {hint}
        </div>
      )}

      {!configured && (
        <a href="/welcome" className="mb-4 block rounded-lg border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 p-4 text-sm">
          <strong>Finish setup</strong> — you haven&apos;t configured Habena yet. <span className="underline">Open the setup wizard →</span>
        </a>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Total decisions" value={sum?.totalDecisions ?? 0} href="/decisions" />
        <Stat label="Allowed" value={sum?.allowed ?? 0} accent="var(--color-allow)" href="/decisions?decision=allow" />
        <Stat label="Denied" value={sum?.denied ?? 0} accent="var(--color-deny)" href="/decisions?decision=deny" />
        <Stat label="Require approval" value={sum?.approvalPending ?? 0} accent="var(--color-warn)" href="/decisions?decision=require_approval" />
        <Stat label="Threat flags" value={sum?.threats ?? 0} accent="var(--color-deny)" href="/decisions?threats=1" />
      </section>

      <p className="mt-6 text-sm text-[var(--color-muted-foreground)]">
        See the full stream in <a href="/decisions" className="underline hover:text-[var(--color-fg)]">Decisions</a>.
      </p>
    </main>
  );
}
