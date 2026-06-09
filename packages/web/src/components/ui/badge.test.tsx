// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders the default label for a kind and pairs it with a glyph (color is not the only channel)", () => {
    render(<Badge kind="deny" />);
    expect(screen.getByText("denied")).toBeInTheDocument();
  });

  it("renders custom children over the default label", () => {
    render(<Badge kind="allow">all good</Badge>);
    expect(screen.getByText("all good")).toBeInTheDocument();
  });
});
