export interface AgentPermissions {
  budget?: {
    daily?: number;
    per_session?: number;
    max_instances?: number;
  };
  tools?: {
    allow?: string[];
    deny?: string[];
    require_approval?: string[];
  };
  paths?: {
    writable?: string[];
    readable?: string[];
  };
  domains?: {
    trusted?: string[];
    blocked?: string[];
  };
  mcp_servers?: {
    allowed?: string[];
    blocked?: string[];
  };
}

export interface AgentType {
  name: string;
  fingerprint: string;
  registered: string;  // ISO 8601 date
  mode: "enforced" | "learning" | "advisory";
  permissions: AgentPermissions;
}

export interface AgentInstance {
  agentType: string;
  instanceId: string;
  startedAt: Date;
  status: "running" | "idle" | "stopped";
  spend: number;
  callCount: number;
}

export interface AgentsFile {
  agents: Record<string, AgentType>;
}
