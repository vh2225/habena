"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { actionKind, type PolicyView } from "@/lib/policy";

const POLL_MS = 5000;
const EMPTY: PolicyView = { configured: false, budget: null, rules: [], extendsPacks: [], approval: null, downstreams: [] };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

export default function PolicyPage() {
  const [p, setP] = useState<PolicyView>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = (await fetch("/api/policy", { cache: "no-store" }).then((x) => x.json())) as PolicyView;
        if (cancelled) return;
        setP(r);
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
        <h1 className="text-xl font-semibold">Policy</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Your policy configuration — what&apos;s in <code>config.yaml</code>. Inherited rule packs add more rules at runtime.
        </p>
      </header>

      {loaded && !p.configured && (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          No policy yet — run <code>habena init</code> or finish setup in <a href="/welcome" className="underline">the wizard</a>.
        </div>
      )}

      {p.configured && (
        <div className="flex flex-col gap-3">
          {p.budget && (p.budget.daily !== null || p.budget.monthly !== null || p.budget.perSession !== null || p.budget.perRequest !== null || p.budget.onExceed) && (
            <Section title="Budget">
              <div className="grid grid-cols-2 gap-2 text-xs text-[var(--color-muted-foreground)] sm:grid-cols-3">
                {p.budget.daily !== null && <div>daily: <span className="text-[var(--color-fg)]">${p.budget.daily}</span></div>}
                {p.budget.monthly !== null && <div>monthly: <span className="text-[var(--color-fg)]">${p.budget.monthly}</span></div>}
                {p.budget.perSession !== null && <div>per session: <span className="text-[var(--color-fg)]">${p.budget.perSession}</span></div>}
                {p.budget.perRequest !== null && <div>per request: <span className="text-[var(--color-fg)]">${p.budget.perRequest}</span></div>}
                {p.budget.onExceed && <div>on exceed: <span className="text-[var(--color-fg)]">{p.budget.onExceed}</span></div>}
              </div>
            </Section>
          )}

          <Section title={`Rules (${p.rules.length}) — first match wins`}>
            {p.rules.length === 0 ? (
              <div className="text-xs text-[var(--color-muted-foreground)]">No inline rules.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {p.rules.map((r) => (
                  <div key={r.index} className="flex flex-wrap items-center gap-2 border-b border-[var(--color-surface-2)] pb-2 text-xs">
                    <span className="w-5 shrink-0 text-[var(--color-muted-foreground)]">{r.index + 1}.</span>
                    <Badge kind={actionKind(r.action)}>{r.action || "—"}</Badge>
                    {r.enforcement && <Badge kind="neutral">{r.enforcement}</Badge>}
                    <code className="text-[var(--color-fg)]">{JSON.stringify(r.match)}</code>
                    {r.reason && <span className="text-[var(--color-muted-foreground)]">— {r.reason}</span>}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {p.extendsPacks.length > 0 && (
            <Section title="Inherited rule packs">
              <div className="flex flex-wrap gap-2 text-xs">
                {p.extendsPacks.map((name) => <Badge key={name} kind="neutral">{name}</Badge>)}
              </div>
              <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">These packs add built-in rules resolved at runtime (not shown here).</p>
            </Section>
          )}

          {p.approval && (
            <Section title="Approval">
              <div className="flex flex-col gap-1 text-xs text-[var(--color-muted-foreground)]">
                {p.approval.timeoutAction && <div>on timeout: <span className="text-[var(--color-fg)]">{p.approval.timeoutAction}</span></div>}
                {p.approval.alwaysRequire.length > 0 && <div>always require approval: <span className="text-[var(--color-fg)]">{p.approval.alwaysRequire.join(", ")}</span></div>}
                <div>channels: <span className="text-[var(--color-fg)]">{p.approval.channels.length > 0 ? p.approval.channels.join(", ") : "none"}</span></div>
              </div>
            </Section>
          )}

          {p.downstreams.length > 0 && (
            <Section title="Downstreams">
              <div className="flex flex-col gap-1 text-xs text-[var(--color-muted-foreground)]">
                {p.downstreams.map((d) => (
                  <div key={d.name}>
                    <span className="font-mono text-[var(--color-fg)]">{d.name}</span>
                    {d.command && <span> · {d.command}</span>}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </main>
  );
}
