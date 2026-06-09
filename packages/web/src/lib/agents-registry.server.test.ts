import { describe, it, expect } from "vitest";
import { parseRegistry } from "./agents-registry.server";

describe("parseRegistry", () => {
  it("maps agents.yaml entries to RegistryAgent (budget from permissions.budget.daily)", () => {
    const yaml = [
      "agents:",
      "  openclaw:",
      "    name: openclaw",
      "    fingerprint: oc-abc",
      "    registered: 2026-06-01",
      "    mode: enforced",
      "    permissions:",
      "      budget:",
      "        daily: 30",
    ].join("\n");
    const out = parseRegistry(yaml);
    expect(out).toEqual([{ name: "openclaw", mode: "enforced", registered: "2026-06-01", fingerprint: "oc-abc", budgetDaily: 30 }]);
  });

  it("handles missing budget / empty file / malformed yaml without throwing", () => {
    expect(parseRegistry("agents: {}\n")).toEqual([]);
    expect(parseRegistry(null)).toEqual([]);
    expect(parseRegistry(":::bad")).toEqual([]);
    const out = parseRegistry("agents:\n  bare:\n    name: bare\n    mode: advisory\n");
    expect(out[0].budgetDaily).toBeNull();
  });
});
