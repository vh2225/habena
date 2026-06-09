"use client";
import type { ReactNode } from "react";
import { Nav } from "./nav";
import { StatusBar } from "./status-bar";
import { CommandPalette } from "@/components/command-palette";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-52 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)]">
        <Nav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <StatusBar />
        <div className="flex-1">{children}</div>
      </div>
      <CommandPalette />
    </div>
  );
}
