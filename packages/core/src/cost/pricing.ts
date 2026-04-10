/**
 * Model pricing table for cost estimation.
 * Prices in USD per 1M tokens.
 */

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-sonnet-4": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-haiku-3.5": { inputPerMillion: 0.8, outputPerMillion: 4 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 10 },
  "gemini-2.5-flash": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}
