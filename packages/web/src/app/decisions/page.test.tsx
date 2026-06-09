// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

beforeEach(() => vi.restoreAllMocks());

const rows = [
  { id: 1, timestamp: "2026-06-09T12:00:00.000Z", agentType: "openclaw", instanceId: "i1", tool: "fs.read", mcpServer: "filesystem", decision: "allow", tier: "default", ruleMatched: null, reason: null, latencyMs: 3, resultStatus: "ok" },
  { id: 2, timestamp: "2026-06-09T12:01:00.000Z", agentType: "hermes", instanceId: "i2", tool: "fs.write", mcpServer: "filesystem", decision: "deny", tier: "user_rule", ruleMatched: "no-writes", reason: "blocked", latencyMs: 5, resultStatus: "blocked" },
];

function stub() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, rows }) }));
}

describe("Decisions page", () => {
  it("renders a row per decision", async () => {
    stub();
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText("fs.read")).toBeInTheDocument());
    expect(screen.getByText("fs.write")).toBeInTheDocument();
  });

  it("filters by decision", async () => {
    stub();
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText("fs.read")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/decision/i), { target: { value: "deny" } });
    expect(screen.queryByText("fs.read")).toBeNull();
    expect(screen.getByText("fs.write")).toBeInTheDocument();
  });

  it("opens the drawer with the policy why on row click", async () => {
    stub();
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText("fs.write")).toBeInTheDocument());
    fireEvent.click(screen.getByText("fs.write"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/no-writes/)).toBeInTheDocument();
  });
});
