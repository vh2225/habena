/**
 * Agent type registration and lookup.
 * Manages ~/.agentguard/agents.yaml — the registry of known agent types
 * and their per-agent permissions.
 */

export interface AgentPermissions {
  budget: {
    daily?: number;
    per_session?: number;
    max_instances?: number;
  };
  tools: {
    allow?: string[];
    deny?: string[];
    require_approval?: string[];
  };
  paths: {
    writable?: string[];
    readable?: string[];
  };
  domains: {
    trusted?: string[];
    blocked?: string[];
  };
  mcp_servers: {
    allowed?: string[];
    blocked?: string[];
  };
}

export interface AgentType {
  name: string;
  fingerprint: string;
  registered: Date;
  mode: "enforced" | "learning" | "advisory";
  profilePath?: string;
  permissions: AgentPermissions;
}

export class AgentRegistry {
  private agents: Map<string, AgentType> = new Map();

  constructor(configPath?: string) {
    // TODO: Load agents.yaml
  }

  register(agent: AgentType): void {
    this.agents.set(agent.name, agent);
  }

  lookup(name: string): AgentType | undefined {
    return this.agents.get(name);
  }

  lookupByFingerprint(fingerprint: string): AgentType | undefined {
    return Array.from(this.agents.values()).find(
      (a) => a.fingerprint === fingerprint
    );
  }

  list(): AgentType[] {
    return Array.from(this.agents.values());
  }

  createVariant(name: string, fromAgent: string, overrides: Partial<AgentPermissions>): AgentType {
    // TODO: Clone an existing agent type with permission overrides
    throw new Error("Not implemented");
  }
}
