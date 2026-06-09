// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

beforeEach(() => vi.restoreAllMocks());

function stubStatus(status: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(status) }));
}
const EMPTY = { configExists: false, downstreams: [], agents: [], telegramConfigured: false, proxyRunning: false, decisionCount: 0 };

describe("Welcome wizard", () => {
  it("shows the init command and marks no steps done when nothing is configured", async () => {
    stubStatus(EMPTY);
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText("habena init")).toBeInTheDocument());
    expect(screen.getByText(/Initialize/i)).toBeInTheDocument();
    expect(screen.queryByText(/your agent is guarded/i)).toBeNull();
  });

  it("reflects the budget input in the agent command", async () => {
    stubStatus({ ...EMPTY, configExists: true, downstreams: ["filesystem"] });
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/habena agent add/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/daily budget/i), { target: { value: "50" } });
    expect(screen.getByText(/--budget-daily 50/)).toBeInTheDocument();
  });

  it("toggles aria-pressed on the target picker", async () => {
    stubStatus(EMPTY);
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByRole("button", { name: "OpenClaw" })).toBeInTheDocument());
    // OpenClaw is the default selection
    expect(screen.getByRole("button", { name: "OpenClaw" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Hermes" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Hermes" }));
    expect(screen.getByRole("button", { name: "Hermes" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "OpenClaw" })).toHaveAttribute("aria-pressed", "false");
  });

  it("celebrates when everything is set up and a decision has been recorded", async () => {
    stubStatus({ configExists: true, downstreams: ["filesystem"], agents: ["openclaw"], telegramConfigured: false, proxyRunning: true, decisionCount: 1 });
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/your agent is guarded/i)).toBeInTheDocument());
  });
});
