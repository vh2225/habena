/**
 * Tracks spend per agent, per session, per day, per month.
 */

import type { BudgetConfig } from "../policy/parser.js";

export interface SpendRecord {
  agent: string;
  sessionId: string;
  tool: string;
  cost: number;
  timestamp: Date;
}

export interface SpendSummary {
  session: number;
  daily: number;
  monthly: number;
}

export class CostTracker {
  private records: SpendRecord[] = [];
  private budget: BudgetConfig;

  constructor(configPath: string) {
    // TODO: Load budget config
    this.budget = {};
  }

  record(spend: SpendRecord): void {
    this.records.push(spend);
  }

  getSummary(agent: string, sessionId: string): SpendSummary {
    // TODO: Calculate aggregated spend
    throw new Error("Not implemented");
  }

  checkBudget(agent: string, sessionId: string, proposedCost: number): {
    allowed: boolean;
    reason?: string;
    alertThreshold?: number;
  } {
    // TODO: Check if proposed cost would exceed any budget limit
    throw new Error("Not implemented");
  }
}
