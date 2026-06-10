"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type StatusResp = { ok: boolean; pending: number; lockdown: boolean; overrides?: number };
const POLL_MS = 2000;

export function StatusBar() {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = (await fetch("/api/status", { cache: "no-store" }).then((x) => x.json())) as StatusResp;
        if (!cancelled) setStatus(r);
      } catch {
        if (!cancelled) setStatus({ ok: false, pending: 0, lockdown: false });
      }
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  async function toggleLockdown(on: boolean) {
    if (on && !window.confirm("Engage lockdown? EVERY tool call will be denied until released.")) return;
    setBusy(true);
    try {
      await fetch("/api/lockdown", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on }),
      });
      const r = (await fetch("/api/status", { cache: "no-store" }).then((x) => x.json())) as StatusResp;
      setStatus(r);
    } finally {
      setBusy(false);
    }
  }

  const up = status === null ? null : status.ok;
  const lockdown = status?.lockdown === true;

  return (
    <div>
      <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full ${
              up === false
                ? "bg-[var(--color-deny)]"
                : up
                ? "hb-live-dot bg-[var(--color-allow)]"
                : "bg-[var(--color-muted-foreground)]"
            }`}
          />
          <span className="text-[var(--color-muted-foreground)]">
            {up === false ? "Proxy not reachable" : up ? "Proxy connected" : "Checking proxy…"}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {up === true && (
            <Link
              href="/approvals"
              aria-live="polite"
              className={
                (status?.pending ?? 0) > 0
                  ? "font-medium text-[var(--color-warn)] hover:underline"
                  : "text-[var(--color-muted-foreground)] hover:text-[var(--color-fg)]"
              }
            >
              {status?.pending ?? 0} pending
            </Link>
          )}
          {up === true && !lockdown && (
            <button
              onClick={() => toggleLockdown(true)}
              disabled={busy}
              title="Deny every tool call until released (habena lockdown)"
              className="rounded border border-[var(--color-border-strong)] px-2 py-0.5 text-[var(--color-muted-foreground)] transition-colors hover:border-[var(--color-deny)] hover:text-[var(--color-deny)] disabled:opacity-50"
            >
              🔒 Lockdown
            </button>
          )}
        </div>
      </div>

      {lockdown && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-[var(--color-deny)] bg-[var(--color-deny)]/15 px-4 py-2 text-xs"
        >
          <span className="font-semibold text-[var(--color-deny)]">
            🔒 LOCKDOWN ACTIVE — every tool call is denied
          </span>
          <button
            onClick={() => toggleLockdown(false)}
            disabled={busy}
            className="rounded border border-[var(--color-deny)] px-2 py-0.5 font-medium text-[var(--color-deny)] transition-colors hover:bg-[var(--color-deny)] hover:text-[var(--color-bg)] disabled:opacity-50"
          >
            Release
          </button>
        </div>
      )}
    </div>
  );
}
