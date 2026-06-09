// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    stubFetch({ ok: true, pending: [{ id: "a" }, { id: "b" }] });
    render(<StatusBar />);
    await waitFor(() => expect(screen.getByText(/2 pending/i)).toBeInTheDocument());
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
  });

  it("shows 'proxy not reachable' when down", async () => {
    stubFetch({ ok: false, pending: [], hint: "habena start" });
    render(<StatusBar />);
    await waitFor(() => expect(screen.getByText(/not reachable/i)).toBeInTheDocument());
  });
});
