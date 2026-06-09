// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

beforeEach(() => vi.restoreAllMocks());
function stub(view: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(view) }));
}

describe("Policy page", () => {
  it("renders budget + a rule row with action and enforcement badges", async () => {
    stub({
      configured: true,
      budget: { daily: 50, monthly: null, perSession: null, perRequest: null, onExceed: "deny", alertAt: null },
      rules: [{ index: 0, match: { tool: "write_file" }, action: "require_approval", enforcement: "hard_mandatory", reason: "writes" }],
      extendsPacks: ["filesystem-readonly"],
      approval: { timeoutAction: "deny", alwaysRequire: ["shell_execute"], channels: ["telegram"] },
      downstreams: [{ name: "filesystem", command: "npx" }],
    });
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/require_approval/)).toBeInTheDocument());
    expect(screen.getByText(/hard_mandatory/)).toBeInTheDocument();
    expect(screen.getByText(/filesystem-readonly/)).toBeInTheDocument();
    expect(screen.getByText(/\$50/)).toBeInTheDocument();
  });

  it("shows a teaching empty state when not configured", async () => {
    stub({ configured: false, budget: null, rules: [], extendsPacks: [], approval: null, downstreams: [] });
    const Page = (await import("./page")).default;
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/no policy yet/i)).toBeInTheDocument());
  });
});
