type Kind = "allow" | "deny" | "warn" | "neutral" | "threat";

const STYLES: Record<Kind, { cls: string; glyph: string; label: string }> = {
  allow:   { cls: "text-[var(--color-allow)] border-[var(--color-allow)]/50 bg-[var(--color-allow)]/10", glyph: "✓", label: "allowed" },
  deny:    { cls: "text-[var(--color-deny)] border-[var(--color-deny)]/50 bg-[var(--color-deny)]/10",     glyph: "⛔", label: "denied" },
  warn:    { cls: "text-[var(--color-warn)] border-[var(--color-warn)]/50 bg-[var(--color-warn)]/10",     glyph: "⏳", label: "needs approval" },
  neutral: { cls: "text-[var(--color-muted-foreground)] border-[var(--color-border)] bg-[var(--color-surface-2)]", glyph: "•", label: "info" },
  threat:  { cls: "text-[var(--color-deny)] border-[var(--color-deny)]/50 bg-[var(--color-deny)]/10",     glyph: "⚠", label: "threat" },
};

export function Badge({ kind, children }: { kind: Kind; children?: React.ReactNode }) {
  const s = STYLES[kind];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold ${s.cls}`}
    >
      <span aria-hidden>{s.glyph}</span>
      <span>{children ?? s.label}</span>
    </span>
  );
}
