"use client";
import { useEffect, useState } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import type { SerializedPendingApproval, ApprovalChoice } from "@/lib/approval-protocol";

function truncateArgs(args: Record<string, unknown>, max = 600): string {
  const s = JSON.stringify(args, null, 2);
  return s.length > max ? s.slice(0, max) + "\n… (truncated)" : s;
}
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
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = nowMs === null ? null : secondsLeft(approval.expiresAt, nowMs);
  const urgent = left !== null && left <= 10;

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
    <Card className="p-4">
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

      <pre className="mt-3 max-h-48 overflow-auto rounded bg-[var(--color-bg)] p-3 text-xs text-[var(--color-fg)] font-mono">{truncateArgs(approval.args)}</pre>

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
    </Card>
  );
}
