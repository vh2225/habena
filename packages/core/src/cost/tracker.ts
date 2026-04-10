export interface SpendRecord {
  agentType: string;
  instanceId: string;
  tool: string;
  cost: number;
  timestamp: Date;
}

export class CostTracker {
  private records: SpendRecord[] = [];

  record(spend: SpendRecord): void {
    this.records.push(spend);
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
}
