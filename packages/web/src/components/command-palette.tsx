"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";

const PAGES = [
  { label: "Overview", href: "/" },
  { label: "Decisions", href: "/decisions" },
  { label: "Approvals", href: "/approvals" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-32"
      role="presentation"
      onClick={() => setOpen(false)}
    >
      <Command
        label="Command palette"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
      >
        <Command.Input
          autoFocus
          placeholder="Jump to…"
          className="w-full bg-transparent px-4 py-3 text-sm outline-none"
        />
        <Command.List className="max-h-72 overflow-auto p-2">
          <Command.Empty className="px-2 py-3 text-sm text-[var(--color-muted-foreground)]">
            No matches.
          </Command.Empty>
          {PAGES.map((p) => (
            <Command.Item
              key={p.href}
              value={p.label}
              onSelect={() => {
                router.push(p.href);
                setOpen(false);
              }}
              className="cursor-pointer rounded px-2 py-2 text-sm aria-selected:bg-[var(--color-surface-2)]"
            >
              {p.label}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
