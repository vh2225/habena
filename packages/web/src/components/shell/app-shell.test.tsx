// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, pending: [] }) }));

import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("renders nav, status bar, and its children", () => {
    render(<AppShell><div data-testid="child">hello</div></AppShell>);
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByTestId("child")).toHaveTextContent("hello");
  });
});
