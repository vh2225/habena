"use client";
import { useState } from "react";

export function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };
  return (
    <div className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs">
      <span className="text-[var(--color-muted-foreground)] select-none">$</span>
      <code className="flex-1 overflow-x-auto text-[var(--color-fg)]">{command}</code>
      <button
        onClick={copy}
        aria-label="Copy command"
        className="shrink-0 rounded px-2 py-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}
