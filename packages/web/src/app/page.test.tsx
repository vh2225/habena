// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

beforeEach(() => vi.restoreAllMocks());

describe("Overview", () => {
  it("renders the summary stat cards from /api/summary", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (String(url).includes("setup-status")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ configExists: true, downstreams: [], agents: [], telegramConfigured: false, proxyRunning: false, decisionCount: 0 }) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          summary: { totalDecisions: 5, allowed: 3, denied: 1, approvalPending: 1, threats: 2, byAgent: [], byTool: [] },
        }),
      });
    }));
    const Overview = (await import("./page")).default;
    render(<Overview />);
    await waitFor(() => expect(screen.getByText("Allowed")).toBeInTheDocument());
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /overview/i })).toBeInTheDocument();
    // Stat cards deep-link into pre-filtered Decisions views.
    expect(screen.getByRole("link", { name: /total decisions/i })).toHaveAttribute("href", "/decisions");
    expect(screen.getByRole("link", { name: /denied/i })).toHaveAttribute("href", "/decisions?decision=deny");
    expect(screen.getByRole("link", { name: /threat flags/i })).toHaveAttribute("href", "/threats");
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows a Finish setup CTA when not configured", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (String(url).includes("setup-status")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ configExists: false, downstreams: [], agents: [], telegramConfigured: false, proxyRunning: false, decisionCount: 0 }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, summary: { totalDecisions: 0, allowed: 0, denied: 0, approvalPending: 0, byAgent: [], byTool: [] } }) });
    }));
    const Overview = (await import("./page")).default;
    render(<Overview />);
    await waitFor(() => expect(screen.getByRole("link", { name: /finish setup/i })).toHaveAttribute("href", "/welcome"));
  });
});
