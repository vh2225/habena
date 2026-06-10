"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/* 16px stroke icons, inherit currentColor. Decorative only (aria-hidden). */
const I = {
  overview: <path d="M2.5 8.5 8 3l5.5 5.5M4 7.5V13h8V7.5" />,
  decisions: <path d="M3 4.5h10M3 8h10M3 11.5h6" />,
  approvals: <path d="M8 1.8 13.5 4v4c0 3.2-2.2 5.6-5.5 6.7C4.7 13.6 2.5 11.2 2.5 8V4L8 1.8ZM5.8 8l1.6 1.6 2.8-3" />,
  threats: <path d="M8 1.8 13.5 4v4c0 3.2-2.2 5.6-5.5 6.7C4.7 13.6 2.5 11.2 2.5 8V4L8 1.8ZM8 5.2v3.2M8 10.8v.2" />,
  agents: <path d="M5.5 6.5a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0ZM2.8 13.5c.6-2.3 2.7-3.5 5.2-3.5s4.6 1.2 5.2 3.5" />,
  spend: <path d="M2.5 13.5v-4M6.2 13.5V6M9.8 13.5V8.5M13.5 13.5v-9" />,
  policy: <path d="M4 2.5h8v11H4zM6 5.5h4M6 8h4M6 10.5h2.5" />,
} as const;

type Item = { label: string; href: string; icon: ReactNode };
const ITEMS: Item[] = [
  { label: "Overview", href: "/", icon: I.overview },
  { label: "Decisions", href: "/decisions", icon: I.decisions },
  { label: "Approvals", href: "/approvals", icon: I.approvals },
  { label: "Threats", href: "/threats", icon: I.threats },
  { label: "Agents", href: "/agents", icon: I.agents },
  { label: "Spend", href: "/spend", icon: I.spend },
  { label: "Policy", href: "/policy", icon: I.policy },
];

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none"
         stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export function Nav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex h-full flex-col p-3">
      <Link href="/" className="mb-4 flex items-center gap-2.5 rounded px-2 pt-1">
        <svg aria-hidden viewBox="0 0 32 32" className="h-6 w-6">
          <path d="M16 5l9 3.5v7c0 5.5-3.7 9.6-9 11.5-5.3-1.9-9-6-9-11.5v-7L16 5z"
                fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" />
          <path d="M12 16.5l3 3 5.5-6" fill="none" stroke="var(--color-allow)"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-sm font-semibold tracking-wide">Habena</span>
      </Link>

      <div className="flex flex-col gap-0.5">
        {ITEMS.map((it) => {
          const active = pathname === it.href;
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                active
                  ? "bg-[var(--color-surface-3)] text-[var(--color-fg)]"
                  : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
              }`}
            >
              {active && (
                <span aria-hidden className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[var(--color-accent)]" />
              )}
              <Icon>{it.icon}</Icon>
              {it.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-auto px-2.5 pb-1 pt-4 text-[11px] leading-5 text-[var(--color-muted-foreground)]">
        <div>Local-only · no telemetry</div>
        <a
          href="https://github.com/vh2225/habena"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-[var(--color-border-strong)] underline-offset-2 hover:text-[var(--color-fg)]"
        >
          github.com/vh2225/habena
        </a>
      </div>
    </nav>
  );
}
