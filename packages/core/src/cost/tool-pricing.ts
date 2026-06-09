/**
 * Declared per-tool pricing + result-size metering.
 *
 * Habena sits between the agent and its TOOLS, not between the agent and its
 * LLM, so a tool call has no inherent dollar cost. Two honest substitutes:
 *
 *  - `pricing:` in config.yaml declares USD-per-call for metered tools
 *    (search APIs, paid MCP servers). Anything undeclared costs $0.
 *  - Result-size metering estimates the tokens a tool result injects into the
 *    agent's context — the thing that actually drives LLM spend when an agent
 *    loops over large results. See `budget.result_tokens`.
 */

/**
 * Resolve the declared price for a call. Keys may be a bare tool name
 * (`web_search`), a server-qualified name (`brave/web_search`), or a
 * server wildcard (`brave/*`). Most-specific wins: server/tool → tool →
 * server/*. Returns 0 when nothing matches or the price is invalid.
 */
export function resolveToolPrice(
  pricing: Record<string, number> | undefined,
  server: string,
  tool: string
): number {
  if (!pricing) return 0;
  const candidates = [`${server}/${tool}`, tool, `${server}/*`];
  for (const key of candidates) {
    const price = pricing[key];
    if (typeof price === "number" && Number.isFinite(price) && price > 0) {
      return price;
    }
  }
  return 0;
}

/**
 * Rough token estimate for a tool result: serialized length / 4, rounded up.
 * Deliberately crude — it only needs to be proportional, not exact, for the
 * `result_tokens` loop guard. Returns 0 if the result can't be serialized.
 */
export function estimateResultTokens(result: unknown): number {
  try {
    const s = JSON.stringify(result);
    if (!s) return 0;
    return Math.ceil(s.length / 4);
  } catch {
    return 0;
  }
}
