import "./globals.css";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";

export const metadata = {
  title: "Habena",
  description: "Habena local dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
