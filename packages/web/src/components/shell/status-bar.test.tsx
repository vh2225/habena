// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { StatusBar } from "./status-bar";

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

function stubFetch(resp: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    json: () => Promise.resolve(resp),
    ok,
  }));
}

describe("StatusBar", () => {
  it("shows proxy 'connected' and the pending count when up", async () => {
    stubFetch({ ok: true, pending: 2, lockdown: false });
    render(<StatusBar />);
    await waitFor(() => expect(screen.getByText(/2 pending/i)).toBeInTheDocument());
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
    // The panic button is offered when the proxy is up and not locked down.
    expect(screen.getByRole("button", { name: /lockdown/i })).toBeInTheDocument();
  });

  it("shows 'proxy not reachable' when down (and no lockdown button)", async () => {
    stubFetch({ ok: false, pending: 0, lockdown: false });
    render(<StatusBar />);
    await waitFor(() => expect(screen.getByText(/not reachable/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /lockdown/i })).toBeNull();
  });

  it("shows the lockdown banner with a release control when locked down", async () => {
    stubFetch({ ok: true, pending: 0, lockdown: true });
    render(<StatusBar />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/LOCKDOWN ACTIVE/i));
    expect(screen.getByRole("button", { name: /release/i })).toBeInTheDocument();
  });

  it("engaging lockdown asks for confirmation first", async () => {
    stubFetch({ ok: true, pending: 0, lockdown: false });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<StatusBar />);
    await waitFor(() => expect(screen.getByRole("button", { name: /lockdown/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /lockdown/i }));
    expect(confirm).toHaveBeenCalled();
    // Declined → no POST: only the polling GETs hit fetch.
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    );
    expect(calls).toHaveLength(0);
  });
});
