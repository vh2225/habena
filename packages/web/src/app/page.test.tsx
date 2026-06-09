// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

beforeEach(() => vi.restoreAllMocks());

describe("Overview", () => {
  it("renders the summary stat cards from /api/summary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        summary: { totalDecisions: 5, allowed: 3, denied: 1, approvalPending: 1, byAgent: [], byTool: [] },
      }),
    }));
    const Overview = (await import("./page")).default;
    render(<Overview />);
    await waitFor(() => expect(screen.getByText("Allowed")).toBeInTheDocument());
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
