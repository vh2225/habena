type Variant = "primary" | "safe" | "danger" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary: "bg-[var(--color-accent)] text-black hover:opacity-90",
  safe:    "bg-[var(--color-surface-2)] text-[var(--color-fg)] border border-[var(--color-border)] hover:border-[var(--color-accent)]",
  danger:  "bg-transparent text-[var(--color-deny)] border border-[var(--color-deny)]/60 hover:bg-[var(--color-deny)]/10",
  ghost:   "bg-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-fg)]",
};

export function Button(
  { variant = "safe", className = "", ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${VARIANT[variant]} ${className}`}
      {...props}
    />
  );
}
