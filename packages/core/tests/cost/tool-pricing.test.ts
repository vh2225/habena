import { describe, it, expect } from "vitest";
import { resolveToolPrice, estimateResultTokens } from "../../src/cost/tool-pricing.js";

describe("resolveToolPrice", () => {
  const pricing = {
    "web_search": 0.01,
    "brave/local_search": 0.005,
    "scraper/*": 0.002,
  };

  it("matches an exact tool name", () => {
    expect(resolveToolPrice(pricing, "search", "web_search")).toBe(0.01);
  });

  it("matches server/tool before bare tool name", () => {
    const p = { "web_search": 0.01, "brave/web_search": 0.03 };
    expect(resolveToolPrice(p, "brave", "web_search")).toBe(0.03);
  });

  it("matches a server/* wildcard", () => {
    expect(resolveToolPrice(pricing, "scraper", "fetch_page")).toBe(0.002);
  });

  it("returns 0 when nothing matches", () => {
    expect(resolveToolPrice(pricing, "fs", "read_file")).toBe(0);
    expect(resolveToolPrice(undefined, "fs", "read_file")).toBe(0);
  });

  it("ignores non-numeric and negative prices", () => {
    expect(resolveToolPrice({ x: -1 } as Record<string, number>, "s", "x")).toBe(0);
    expect(resolveToolPrice({ x: "1" } as unknown as Record<string, number>, "s", "x")).toBe(0);
  });
});

describe("estimateResultTokens", () => {
  it("estimates ~chars/4 of the serialized result, rounded up", () => {
    expect(estimateResultTokens({ content: [{ type: "text", text: "abcd".repeat(100) }] })).toBeGreaterThan(100);
    expect(estimateResultTokens("abcdefgh")).toBe(3); // '"abcdefgh"' = 10 chars → 3
  });

  it("never throws on unserializable input", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(estimateResultTokens(circular)).toBe(0);
    expect(estimateResultTokens(undefined)).toBe(0);
  });
});
