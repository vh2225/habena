"use client";
import { useEffect, useRef, useState } from "react";
import { Badge } from "./ui/badge";
import { fmtTime, fmtLatency, decisionKind, isThreat, prettyArgs, type DecisionRow } from "@/lib/dashboard";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--color-border)] py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-0.5 text-sm text-[var(--color-fg)] font-mono break-words">{value}</div>
    </div>
  );
}

function ArgsField({ raw }: { raw: string | null }) {
  const [copied, setCopied] = useState(false);
  const pretty = prettyArgs(raw);
  async function copy() {
    try {
      await navigator.clipboard.writeText(raw ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (http, permissions) — button just won't confirm */
    }
  }
  return (
    <div className="border-b border-[var(--color-border)] py-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)]">Args</div>
        {raw && (
          <button
            onClick={copy}
            className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted-foreground)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]"
          >
            {copied ? "✓ copied" : "copy"}
          </button>
        )}
      </div>
      <pre className="mt-1 max-h-56 overflow-auto rounded-md bg-[var(--color-bg)] p-2.5 text-xs leading-relaxed text-[var(--color-fg)]">{pretty}</pre>
      {raw?.endsWith("…") && (
        <div className="mt-1 text-[10px] text-[var(--color-muted-foreground)]">
          Preview truncated at 2KB — the full args are in the audit DB (`habena logs`).
        </div>
      )}
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
        <ArgsField raw={row.argsPreview} />
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
