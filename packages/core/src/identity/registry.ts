import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parse, stringify } from "yaml";
import type { AgentType, AgentPermissions, AgentsFile } from "./types.js";

/**
 * Agent type registration and lookup.
 * Manages agents.yaml — the registry of known agent types
 * and their per-agent permissions.
 */
export class AgentRegistry {
  private agents: Map<string, AgentType> = new Map();
  private path: string;

  constructor(path: string) {
    this.path = path;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    const content = readFileSync(this.path, "utf8");
    const data = parse(content) as AgentsFile | null;
    if (!data?.agents) return;
    for (const [name, agent] of Object.entries(data.agents)) {
      this.agents.set(name, { ...agent, name });
    }
  }

  save(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data: AgentsFile = {
      agents: Object.fromEntries(this.agents),
    };
    writeFileSync(this.path, stringify(data), "utf8");
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

  createVariant(
    name: string,
    fromAgent: string,
    overrides: Partial<AgentPermissions>
  ): AgentType {
    const base = this.agents.get(fromAgent);
    if (!base) {
      throw new Error(`Base agent not found: ${fromAgent}`);
    }
    const variant: AgentType = {
      name,
      fingerprint: `${base.fingerprint}-${name}`,
      registered: new Date().toISOString().split("T")[0],
      mode: base.mode,
      permissions: { ...base.permissions, ...overrides },
    };
    this.agents.set(name, variant);
    return variant;
  }
}
