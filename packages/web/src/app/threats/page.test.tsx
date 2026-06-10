// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

beforeEach(() => vi.restoreAllMocks());

const threats = {
  totalEvents: 5,
  eventsToday: 2,
  byDetector: [
    { detector: "credential_egress", count: 3 },
    { detector: "rug_pull", count: 2 },
  ],
  groups: [
    {
      mcpServer: "fs", tool: "read_file", detector: "credential_egress",
      count: 3, firstSeen: "2026-06-09T10:00:00.000Z", lastSeen: "2026-06-10T01:00:00.000Z",
      lastReason: "threat:credential_egress: secret in args (match:aws-key)",
      denied: 2, allowed: 1, escalated: 0,
    },
  ],
};

describe("Threats page", () => {
  it("renders detector breakdown and grouped findings with outcomes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, threats }) }));
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText("Threat events (all time)")).toBeInTheDocument());
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getAllByText(/Credential egress/i).length).toBeGreaterThan(0);
    expect(screen.getByText("fs/read_file")).toBeInTheDocument();
    expect(screen.getByText(/match:aws-key/)).toBeInTheDocument();
    expect(screen.getByText("denied")).toBeInTheDocument();
  });

  it("shows the empty state when there are no findings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, threats: { totalEvents: 0, eventsToday: 0, byDetector: [], groups: [] } }),
    }));
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/No threat findings/)).toBeInTheDocument());
  });
});
