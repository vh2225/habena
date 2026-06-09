"use client";
import { useEffect, useRef } from "react";
import { Badge } from "./ui/badge";
import { fmtTime, fmtLatency, decisionKind, isThreat, type DecisionRow } from "@/lib/dashboard";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--color-border)] py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-0.5 text-sm text-[var(--color-fg)] font-mono break-words">{value}</div>
    </div>
  );
}

export function DecisionDrawer({ row, onClose }: { row: DecisionRow | null; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Focus the panel on open and return focus to the triggering element on close.
  // Deliberately NOT implementing a focus trap or body-scroll-lock: acceptable for a
  // localhost single-user dashboard (and avoids pulling in Radix for one drawer).
  useEffect(() => {
    if (!row) return;
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => { prev?.focus?.(); };
  }, [row]);
  if (!row) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Decision detail for ${row.tool}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        className="relative z-10 h-full w-full max-w-md overflow-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] p-5 focus:outline-none"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Why this decision?</h2>
          <button onClick={onClose} className="text-[var(--color-muted-foreground)] hover:text-[var(--color-fg)]" aria-label="Close">✕</button>
        </div>
        <div className="mb-3 flex items-center gap-2">
          <Badge kind={decisionKind(row.decision)}>{row.decision}</Badge>
          {isThreat(row) && <Badge kind="threat" />}
        </div>
        <Field label="Agent" value={`${row.agentType} · ${(row.instanceId ?? "").slice(0, 8)}`} />
        <Field label="Tool" value={row.tool} />
        <Field label="Server" value={row.mcpServer} />
        <Field label="Tier" value={row.tier} />
        <Field label="Rule matched" value={row.ruleMatched ?? "—"} />
        <Field label="Reason" value={row.reason ?? "—"} />
        <Field label="Latency" value={fmtLatency(row.latencyMs)} />
        <Field label="Result" value={row.resultStatus} />
        <Field label="Time" value={fmtTime(row.timestamp)} />
      </div>
    </div>
  );
}
