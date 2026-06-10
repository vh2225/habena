"use client";
import { useEffect, useState } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import type { SerializedPendingApproval, ApprovalChoice } from "@/lib/approval-protocol";

const PREVIEW_CHARS = 600;

function secondsLeft(expiresAt: string, nowMs: number): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - nowMs) / 1000));
}

export function ApprovalCard(
  { approval, onResolve }:
  { approval: SerializedPendingApproval; onResolve: (id: string, choice: ApprovalChoice) => Promise<boolean> }
) {
  // Tick once a second for the countdown. Initialized lazily to avoid SSR/clock mismatch.
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = nowMs === null ? null : secondsLeft(approval.expiresAt, nowMs);
  const urgent = left !== null && left <= 10;

  // Time-pressure bar: fraction of the approval window remaining.
  const totalSec = Math.max(
    1,
    Math.round((new Date(approval.expiresAt).getTime() - new Date(approval.createdAt).getTime()) / 1000)
  );
  const frac = left === null ? 1 : Math.min(1, left / totalSec);
  const barColor = urgent ? "var(--color-deny)" : (left ?? totalSec) <= 30 ? "var(--color-warn)" : "var(--color-accent)";

  const fullArgs = JSON.stringify(approval.args, null, 2);
  const truncated = fullArgs.length > PREVIEW_CHARS;
  const shownArgs = expanded || !truncated ? fullArgs : fullArgs.slice(0, PREVIEW_CHARS) + "\n…";

  async function copyArgs() {
    try {
      await navigator.clipboard.writeText(fullArgs);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — button just won't confirm */
    }
  }

  const act = async (choice: ApprovalChoice) => {
    setBusy(true);
    setError(null);
    const ok = await onResolve(approval.id, choice);
    // On success the parent drops this card (unmount); on failure re-enable + explain.
    if (!ok) {
      setBusy(false);
      setError("Couldn't resolve — it may have already expired. Try again.");
    }
  };

  return (
    <Card className="overflow-hidden">
      {/* Shrinking time bar across the top of the card. */}
      <div aria-hidden className="h-0.5 w-full bg-[var(--color-surface-2)]">
        <div
          className="h-full transition-[width] duration-1000 ease-linear"
          style={{ width: `${frac * 100}%`, background: barColor }}
        />
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-[var(--color-muted-foreground)]">
              <span className="font-mono text-[var(--color-fg)]">{approval.agentType}</span>
              {" wants to call "}
              <span className="font-mono text-[var(--color-fg)]">{approval.tool}</span>
            </div>
            <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">{approval.reason}</div>
          </div>
          <Badge kind="warn">
            {left === null ? "needs approval" : urgent ? `${left}s left` : `expires in ${left}s`}
          </Badge>
        </div>

        <div className="relative mt-3">
          <pre className={`overflow-auto rounded-md bg-[var(--color-bg)] p-3 font-mono text-xs text-[var(--color-fg)] ${expanded ? "max-h-96" : "max-h-48"}`}>{shownArgs}</pre>
          <div className="absolute right-2 top-2 flex gap-1">
            {truncated && (
              <button
                onClick={() => setExpanded((e) => !e)}
                className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted-foreground)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]"
              >
                {expanded ? "collapse" : "show all"}
              </button>
            )}
            <button
              onClick={copyArgs}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted-foreground)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]"
            >
              {copied ? "✓ copied" : "copy"}
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="mt-2 text-xs text-[var(--color-deny)]">{error}</div>
        )}

        {/* Safe choices first/low-friction; Deny is visually separated and not the primary. */}
        <div className="mt-3 flex items-center gap-2">
          <Button variant="primary" disabled={busy} onClick={() => act("allow_once")}>Allow once</Button>
          <Button variant="safe" disabled={busy} onClick={() => act("allow_session")} title="Allows this tool for this agent for 1 hour">Allow this session (1h)</Button>
          <div className="flex-1" />
          <Button variant="danger" disabled={busy} onClick={() => act("deny")}><span aria-hidden>⛔</span> Deny</Button>
        </div>
      </div>
    </Card>
  );
}
