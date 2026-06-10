export interface SpendRecord {
  agentType: string;
  instanceId: string;
  tool: string;
  cost: number;
  timestamp: Date;
}

export interface TokenRecord {
  agentType: string;
  instanceId: string;
  tokens: number;
  timestamp: Date;
}

/**
 * In-memory usage counters for budget enforcement. Keeps the current
 * calendar month (the longest budget window); older records are pruned
 * periodically so a long-running proxy doesn't grow without bound.
 */
export class CostTracker {
  private records: SpendRecord[] = [];
  private tokenRecords: TokenRecord[] = [];
  private insertsSincePrune = 0;

  /** `persist.resultTokens` is called on every live meter reading (write-through),
   * so token counters survive a proxy restart via hydrateResultTokens(). Spend
   * records need no sink — the audit log already persists every allowed call. */
  constructor(private persist?: { resultTokens?: (r: TokenRecord) => void }) {}

  record(spend: SpendRecord): void {
    this.records.push(spend);
    this.maybePrune();
  }

  /** Record the estimated tokens a tool result injected into the agent's context. */
  recordResultTokens(agentType: string, instanceId: string, tokens: number, timestamp: Date = new Date()): void {
    if (tokens <= 0) return;
    const rec = { agentType, instanceId, tokens, timestamp };
    this.tokenRecords.push(rec);
    this.persist?.resultTokens?.(rec);
    this.maybePrune();
  }

  /** Every 1000 inserts, drop records older than the current month start. */
  private maybePrune(): void {
    if (++this.insertsSincePrune < 1000) return;
    this.insertsSincePrune = 0;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    this.records = this.records.filter((r) => r.timestamp >= monthStart);
    this.tokenRecords = this.tokenRecords.filter((r) => r.timestamp >= monthStart);
  }

  /** Restore spend/call records from the audit log at startup (no write-back). */
  hydrateSpend(records: SpendRecord[]): void {
    this.records.push(...records);
  }

  /** Restore meter readings from the result_meter table at startup (no write-back). */
  hydrateResultTokens(records: TokenRecord[]): void {
    this.tokenRecords.push(...records);
  }

  /** Total estimated result tokens for an agent type since `since`. */
  resultTokensSince(agentType: string, since: Date): number {
    return this.tokenRecords
      .filter((r) => r.agentType === agentType && r.timestamp >= since)
      .reduce((sum, r) => sum + r.tokens, 0);
  }

  getInstanceSpend(instanceId: string): number {
    return this.records
      .filter((r) => r.instanceId === instanceId)
      .reduce((sum, r) => sum + r.cost, 0);
  }

  getTypeSpend(agentType: string): number {
    return this.records
      .filter((r) => r.agentType === agentType)
      .reduce((sum, r) => sum + r.cost, 0);
  }

  getDailySpend(agentType: string): number {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    return this.records
      .filter((r) => r.agentType === agentType && r.timestamp >= cutoff)
      .reduce((sum, r) => sum + r.cost, 0);
  }

  getMonthlySpend(agentType: string): number {
    const cutoff = new Date();
    cutoff.setDate(1);
    cutoff.setHours(0, 0, 0, 0);
    return this.records
      .filter((r) => r.agentType === agentType && r.timestamp >= cutoff)
      .reduce((sum, r) => sum + r.cost, 0);
  }

  /** Allowed-call count for an agent type since `since` (each record = one call). */
  countCallsSince(agentType: string, since: Date): number {
    return this.records.filter(
      (r) => r.agentType === agentType && r.timestamp >= since
    ).length;
  }
}
