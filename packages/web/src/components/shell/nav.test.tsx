// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/decisions" }));

import { Nav } from "./nav";

describe("Nav", () => {
  it("marks the active route with aria-current", () => {
    render(<Nav />);
    const active = screen.getByRole("link", { name: /decisions/i });
    expect(active).toHaveAttribute("aria-current", "page");
  });

  it("renders not-yet-built items as disabled (not links)", () => {
    render(<Nav />);
    expect(screen.queryByRole("link", { name: /spend/i })).toBeNull();
    expect(screen.getByText(/spend/i)).toBeInTheDocument();
  });
});
