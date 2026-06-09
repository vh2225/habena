"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { label: string; href: string; soon?: boolean };
const ITEMS: Item[] = [
  { label: "Overview", href: "/" },
  { label: "Decisions", href: "/decisions" },
  { label: "Approvals", href: "/approvals" },
  { label: "Agents", href: "/agents" },
  { label: "Spend", href: "/spend", soon: true },
  { label: "Policy", href: "/policy" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 p-3">
      <div className="px-2 pb-3 text-sm font-semibold tracking-wide">Habena</div>
      {ITEMS.map((it) => {
        if (it.soon) {
          return (
            <span
              key={it.href}
              aria-disabled="true"
              className="flex items-center justify-between rounded px-2 py-1.5 text-sm text-[var(--color-muted-foreground)] opacity-60 cursor-default"
            >
              {it.label}
              <span className="text-[10px] uppercase tracking-wide opacity-70">soon</span>
            </span>
          );
        }
        const active = pathname === it.href;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`rounded px-2 py-1.5 text-sm transition ${
              active
                ? "bg-[var(--color-surface-2)] text-[var(--color-fg)]"
                : "text-[var(--color-muted-foreground)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
