"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCardSkeleton } from "@/components/ui/skeleton";
import { fmtTime } from "@/lib/dashboard";
import type { ThreatSummary } from "@/lib/audit";

type Resp = { ok: boolean; reason?: string; hint?: string; threats: ThreatSummary | null };
const POLL_MS = 5000;

const DETECTOR_LABELS: Record<string, string> = {
  tool_poisoning: "Tool poisoning",
  credential_egress: "Credential egress",
  rug_pull: "Rug pull (definition drift)",
  signatures: "Signature match",
  unknown: "Threat",
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold" style={value > 0 ? { color: "var(--color-deny)" } : undefined}>
        {value.toLocaleString()}
      </div>
    </Card>
  );
}

export default function ThreatsPage() {
  const [threats, setThreats] = useState<ThreatSummary | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = (await fetch("/api/threats", { cache: "no-store" }).then((x) => x.json())) as Resp;
        if (cancelled) return;
        setThreats(r.threats);
        setHint(r.ok ? null : r.hint ?? r.reason ?? null);
      } catch (e) {
        if (!cancelled) setHint((e as Error).message);
      }
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Threats</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Findings from the local threat detectors — tool poisoning, credential egress, rug-pull drift,
          and signature-feed matches. Detection is heuristic; each event also appears in{" "}
          <a href="/decisions?threats=1" className="underline hover:text-[var(--color-fg)]">Decisions</a>.
        </p>
      </header>

      {hint && (
        <div role="status" aria-live="polite" className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-muted-foreground)]">
          {hint}
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {threats === null && !hint ? (
          Array.from({ length: 3 }, (_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <Stat label="Threat events (all time)" value={threats?.totalEvents ?? 0} />
            <Stat label="Today" value={threats?.eventsToday ?? 0} />
            <Card className="p-4">
              <div className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">By detector</div>
              <div className="mt-2 flex flex-col gap-1 text-xs">
                {(threats?.byDetector ?? []).length === 0 && <span className="text-[var(--color-muted-foreground)]">none</span>}
                {(threats?.byDetector ?? []).map((d) => (
                  <div key={d.detector} className="flex justify-between">
                    <span>{DETECTOR_LABELS[d.detector] ?? d.detector}</span>
                    <span className="text-[var(--color-fg)]">{d.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </section>

      <section className="mt-4 flex flex-col gap-3">
        {threats && threats.groups.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
            No threat findings — the detectors run on every tool scan and call, and anything flagged shows up here.
          </div>
        )}
        {(threats?.groups ?? []).map((g) => (
          <Card key={`${g.mcpServer}|${g.tool}|${g.detector}`} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge kind="threat">{DETECTOR_LABELS[g.detector] ?? g.detector}</Badge>
              <span className="font-mono text-sm">{g.mcpServer}/{g.tool}</span>
              <span className="ml-auto text-xs text-[var(--color-muted-foreground)]">
                {g.count.toLocaleString()} event{g.count === 1 ? "" : "s"} · first {fmtTime(g.firstSeen)} · last {fmtTime(g.lastSeen)}
              </span>
            </div>
            <p className="mt-2 break-words font-mono text-xs text-[var(--color-muted-foreground)]">{g.lastReason}</p>
            <div className="mt-2 flex gap-3 text-xs text-[var(--color-muted-foreground)]">
              {g.denied > 0 && <span><span className="text-[var(--color-deny)]">{g.denied}</span> denied</span>}
              {g.escalated > 0 && <span><span className="text-[var(--color-warn)]">{g.escalated}</span> sent to approval</span>}
              {g.allowed > 0 && <span><span className="text-[var(--color-allow)]">{g.allowed}</span> allowed (approved or warn-mode)</span>}
              <a
                className="ml-auto underline hover:text-[var(--color-fg)]"
                href={`/decisions?threats=1`}
              >
                view in decisions →
              </a>
            </div>
          </Card>
        ))}
      </section>
    </main>
  );
}
