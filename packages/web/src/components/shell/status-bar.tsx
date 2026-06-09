"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type ApprovalsResp = { ok: boolean; pending: unknown[] };
const POLL_MS = 2000;

export function StatusBar() {
  const [up, setUp] = useState<boolean | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = (await fetch("/api/approvals", { cache: "no-store" }).then((x) => x.json())) as ApprovalsResp;
        if (cancelled) return;
        setUp(r.ok);
        setPending(Array.isArray(r.pending) ? r.pending.length : 0);
      } catch {
        if (!cancelled) setUp(false);
      }
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`inline-block h-2 w-2 rounded-full ${
            up === false ? "bg-[var(--color-deny)]" : up ? "bg-[var(--color-allow)]" : "bg-[var(--color-muted-foreground)]"
          }`}
        />
        <span className="text-[var(--color-muted-foreground)]">
          {up === false ? "Proxy not reachable" : up ? "Proxy connected" : "Checking proxy…"}
        </span>
      </div>
      <Link href="/approvals" className="text-[var(--color-muted-foreground)] hover:text-[var(--color-fg)]">
        {pending} pending
      </Link>
    </div>
  );
}
