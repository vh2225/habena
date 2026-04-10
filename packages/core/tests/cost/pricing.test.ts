import { describe, it, expect } from "vitest";
import { estimateCost, MODEL_PRICING } from "../../src/cost/pricing.js";

describe("pricing", () => {
  it("returns null for unknown model", () => {
    expect(estimateCost("unknown-model", 1000, 1000)).toBeNull();
  });

  it("calculates cost for claude-sonnet-4", () => {
    const cost = estimateCost("claude-sonnet-4", 1000, 1000);
    expect(cost).toBeCloseTo(0.018);
  });

  it("calculates cost for gpt-4o", () => {
    const cost = estimateCost("gpt-4o", 10000, 5000);
    expect(cost).toBeCloseTo(0.025 + 0.05);
  });

  it("MODEL_PRICING has entries for Claude, GPT, Gemini families", () => {
    const keys = Object.keys(MODEL_PRICING);
    expect(keys.some((k) => k.startsWith("claude"))).toBe(true);
    expect(keys.some((k) => k.startsWith("gpt"))).toBe(true);
    expect(keys.some((k) => k.startsWith("gemini"))).toBe(true);
  });
});
