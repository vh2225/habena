"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApprovalCard } from "@/components/approval-card";
import type { SerializedPendingApproval, ApprovalChoice } from "@/lib/approval-protocol";

type ListResp = { ok: boolean; reason?: string; hint?: string; pending: SerializedPendingApproval[] };
const POLL_MS = 1000;

export default function ApprovalsPage() {
  const [pending, setPending] = useState<SerializedPendingApproval[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [down, setDown] = useState(false);
  const resolving = useRef<Set<string>>(new Set());

  const tick = useCallback(async () => {
    try {
      const r = (await fetch("/api/approvals", { cache: "no-store" }).then((x) => x.json())) as ListResp;
      setDown(!r.ok);
      setHint(r.hint ?? r.reason ?? null);
      // Drop any we've optimistically resolved this cycle.
      setPending(r.pending.filter((p) => !resolving.current.has(p.id)));
    } catch (e) {
      setDown(true);
      setHint((e as Error).message);
    }
  }, []);

  useEffect(() => {
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => clearInterval(t);
  }, [tick]);

  const onResolve = useCallback(async (id: string, choice: ApprovalChoice) => {
    resolving.current.add(id);
    setPending((prev) => prev.filter((p) => p.id !== id)); // optimistic
    try {
      await fetch("/api/approvals/respond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, choice }),
      });
    } finally {
      // Re-sync soon; keep it in the resolved-set briefly so the poll doesn't resurrect it.
      setTimeout(() => resolving.current.delete(id), 3000);
    }
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Approvals</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Tool calls your agent paused for your decision.
        </p>
      </header>

      {down && (
        <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-muted-foreground)]">
          {hint ?? "Proxy not reachable."}
        </div>
      )}

      {!down && pending.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          No approvals waiting — when your agent hits a guarded tool, it shows up here.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {pending.map((p) => (
          <ApprovalCard key={p.id} p={p} onResolve={onResolve} />
        ))}
      </div>
    </main>
  );
}
