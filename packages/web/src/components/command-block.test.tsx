// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandBlock } from "./command-block";

describe("CommandBlock", () => {
  it("shows the command text", () => {
    render(<CommandBlock command="habena init" />);
    expect(screen.getByText("habena init")).toBeInTheDocument();
  });

  it("copies the command to the clipboard on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CommandBlock command="habena init" />);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith("habena init");
  });
});
