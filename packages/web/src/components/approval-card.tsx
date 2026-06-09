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
  { p, onResolve }: { p: SerializedPendingApproval; onResolve: (id: string, choice: ApprovalChoice) => void }
) {
  // Tick once a second for the countdown. Initialized lazily to avoid SSR/clock mismatch.
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = nowMs === null ? null : secondsLeft(p.expiresAt, nowMs);
  const urgent = left !== null && left <= 10;

  const act = (choice: ApprovalChoice) => { setBusy(true); onResolve(p.id, choice); };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-[var(--color-muted-foreground)]">
            <span className="font-mono text-[var(--color-fg)]">{p.agentType}</span>
            {" wants to call "}
            <span className="font-mono text-[var(--color-fg)]">{p.tool}</span>
          </div>
          <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">{p.reason}</div>
        </div>
        <Badge kind="warn">
          {left === null ? "needs approval" : urgent ? `${left}s left` : `expires in ${left}s`}
        </Badge>
      </div>

      <pre className="mt-3 max-h-48 overflow-auto rounded bg-[var(--color-bg)] p-3 text-xs text-[var(--color-fg)] font-mono">
{truncateArgs(p.args)}
      </pre>

      {/* Safe choices first/low-friction; Deny is visually separated and not the primary. */}
      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" disabled={busy} onClick={() => act("allow_once")}>Allow once</Button>
        <Button variant="safe" disabled={busy} onClick={() => act("allow_session")}>Allow this session</Button>
        <div className="flex-1" />
        <Button variant="danger" disabled={busy} onClick={() => act("deny")}>⛔ Deny</Button>
      </div>
    </Card>
  );
}
