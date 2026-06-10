// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DecisionDrawer } from "./decision-drawer";
import type { DecisionRow } from "@/lib/dashboard";

const row: DecisionRow = {
  id: 1, timestamp: "2026-06-09T12:00:00.000Z", agentType: "openclaw", instanceId: "i1",
  tool: "fs.write", mcpServer: "filesystem", decision: "deny", tier: "user_rule",
  ruleMatched: "no-writes", reason: "writes are blocked by policy", latencyMs: 12, resultStatus: "blocked",
  argsPreview: '{"path":"/etc/passwd"}',
};

describe("DecisionDrawer", () => {
  it("shows the policy 'why' (tier, rule, reason) for the row", () => {
    render(<DecisionDrawer row={row} onClose={() => {}} />);
    expect(screen.getByText(/user_rule/)).toBeInTheDocument();
    expect(screen.getByText(/no-writes/)).toBeInTheDocument();
    expect(screen.getByText(/writes are blocked by policy/)).toBeInTheDocument();
  });

  it("is a modal dialog and calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<DecisionDrawer row={row} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when row is null", () => {
    const { container } = render(<DecisionDrawer row={null} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
