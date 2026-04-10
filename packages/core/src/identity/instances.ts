/**
 * Instance tracking — manages running instances of each agent type.
 * Each instance gets a unique session ID, its own spend counter,
 * and its own audit trail.
 */

export interface AgentInstance {
  agentType: string;
  instanceId: string;
  startedAt: Date;
  status: "running" | "idle" | "stopped";
  spend: number;
  callCount: number;
}

export class InstanceTracker {
  private instances: Map<string, AgentInstance> = new Map();

  create(agentType: string): AgentInstance {
    const instanceId = `${agentType}/session-${randomId()}`;
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

  recordSpend(instanceId: string, cost: number): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.spend += cost;
      instance.callCount++;
    }
  }

  stop(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (instance) instance.status = "stopped";
  }
}

function randomId(): string {
  return Math.random().toString(36).substring(2, 8);
}
