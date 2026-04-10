import { randomBytes } from "node:crypto";
import type { AgentInstance } from "./types.js";

export class InstanceTracker {
  private instances: Map<string, AgentInstance> = new Map();

  create(agentType: string): AgentInstance {
    const instanceId = `${agentType}/session-${randomBytes(4).toString("hex")}`;
    const instance: AgentInstance = {
      agentType,
      instanceId,
      startedAt: new Date(),
      status: "running",
      spend: 0,
      callCount: 0,
    };
    this.instances.set(instanceId, instance);
    return instance;
  }

  get(instanceId: string): AgentInstance | undefined {
    return this.instances.get(instanceId);
  }

  listByType(agentType: string): AgentInstance[] {
    return Array.from(this.instances.values()).filter(
      (i) => i.agentType === agentType
    );
  }

  countRunning(agentType: string): number {
    return this.listByType(agentType).filter((i) => i.status === "running").length;
  }

  totalSpendByType(agentType: string): number {
    return this.listByType(agentType).reduce((sum, i) => sum + i.spend, 0);
  }

  recordSpend(instanceId: string, cost: number): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    instance.spend += cost;
    instance.callCount++;
  }

  stop(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (instance) instance.status = "stopped";
  }
}
