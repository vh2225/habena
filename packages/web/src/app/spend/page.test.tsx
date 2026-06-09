// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

beforeEach(() => vi.restoreAllMocks());

const hourly = Array.from({ length: 24 }, (_, i) => ({
  hourIso: new Date(Date.now() - (23 - i) * 3_600_000).toISOString().slice(0, 13),
  calls: i === 23 ? 7 : 0,
  cost: i === 23 ? 0.07 : 0,
}));

const spend = {
  callsToday: 7,
  costToday: 0.07,
  callsLastHour: 7,
  byAgent: [{ agentType: "openclaw", calls: 7, cost: 0.07 }],
  byTool: [{ tool: "web_search", calls: 7, cost: 0.07 }],
  hourly,
};

describe("Spend page", () => {
  it("renders stats, breakdowns, and the declared-pricing framing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, spend }) }));
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText("Calls today")).toBeInTheDocument());
    expect(screen.getAllByText("7").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$0.0700").length).toBeGreaterThan(0);
    expect(screen.getByText("openclaw")).toBeInTheDocument();
    expect(screen.getByText("web_search")).toBeInTheDocument();
    // Honest framing must be on the page, not buried in docs.
    expect(screen.getByText(/not measured LLM spend/i)).toBeInTheDocument();
  });

  it("shows the db hint when the audit db is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: false, hint: "Expected at /home/x/.habena/audit.db", spend: null }),
    }));
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/Expected at/)).toBeInTheDocument());
  });
});
