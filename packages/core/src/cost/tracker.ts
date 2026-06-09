export interface SpendRecord {
  agentType: string;
  instanceId: string;
  tool: string;
  cost: number;
  timestamp: Date;
}

export class CostTracker {
  private records: SpendRecord[] = [];
  private tokenRecords: Array<{ agentType: string; instanceId: string; tokens: number; timestamp: Date }> = [];

  record(spend: SpendRecord): void {
    this.records.push(spend);
  }

  /** Record the estimated tokens a tool result injected into the agent's context. */
  recordResultTokens(agentType: string, instanceId: string, tokens: number, timestamp: Date = new Date()): void {
    if (tokens <= 0) return;
    this.tokenRecords.push({ agentType, instanceId, tokens, timestamp });
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
