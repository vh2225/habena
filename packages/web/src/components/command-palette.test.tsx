// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// jsdom lacks ResizeObserver / scrollIntoView, which cmdk uses internally.
// Standard jsdom shims so the component can mount and drive selection.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.HTMLElement.prototype.scrollIntoView = () => {};

import { CommandPalette } from "./command-palette";

beforeEach(() => push.mockClear());

describe("CommandPalette", () => {
  it("opens on Cmd/Ctrl+K and navigates on selection", () => {
    render(<CommandPalette />);
    expect(screen.queryByPlaceholderText(/jump to/i)).toBeNull();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByPlaceholderText(/jump to/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Decisions"));
    expect(push).toHaveBeenCalledWith("/decisions");
  });
});
