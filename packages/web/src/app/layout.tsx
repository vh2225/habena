import "./globals.css";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";

export const metadata = {
  title: "Habena",
  description: "Habena local dashboard",
};

export const viewport = {
  themeColor: "#0b0b0d",
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
