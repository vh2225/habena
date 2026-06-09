// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

beforeEach(() => vi.restoreAllMocks());

function stub(agents: unknown[]) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ agents }) }));
}

describe("Agents page", () => {
  it("renders a card per agent with its mode and decision total", async () => {
    stub([
      { name: "openclaw", status: "registered", mode: "enforced", registered: "2026-06-01", fingerprint: "oc", budgetDaily: 30, decisions: { total: 5, allow: 3, deny: 1, approval: 1 }, topTools: [{ tool: "fs.read", count: 3 }], instancesSeen: 2, lastSeen: "2026-06-09T12:00:00.000Z" },
    ]);
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText("openclaw")).toBeInTheDocument());
    expect(screen.getByText(/enforced/i)).toBeInTheDocument();
    expect(screen.getByText(/Daily budget: \$30/)).toBeInTheDocument();
  });

  it("flags an observed-but-unregistered agent", async () => {
    stub([
      { name: "rogue", status: "observed", mode: null, registered: null, fingerprint: null, budgetDaily: null, decisions: { total: 2, allow: 0, deny: 2, approval: 0 }, topTools: [], instancesSeen: 1, lastSeen: "2026-06-09T12:00:00.000Z" },
    ]);
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText("rogue")).toBeInTheDocument());
    expect(screen.getByText(/unregistered/i)).toBeInTheDocument();
  });

  it("shows a teaching empty state when there are no agents", async () => {
    stub([]);
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/no agents yet/i)).toBeInTheDocument());
  });
});
