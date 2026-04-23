import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";
import type { AgentGuardConfig, Rule } from "../policy/types.js";
import { resolveExtends } from "../policy/packs.js";
import { getHostPolicyPath } from "./paths.js";

export interface HostPolicy {
  rules?: Rule[];
  extends?: string[];
  /** Free-form note the operator may put at the top of the file. */
  description?: string;
}

export function loadYaml<T = unknown>(path: string): T | null {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf8");
  return parse(content) as T;
}

/**
 * Load the AgentGuard config AND expand any `extends:` rule packs into
 * the `rules` array. Returns the expanded config + diagnostics about
 * missing packs. Loader callers at runtime (agentguard start,
 * downstream-reachable check, etc.) should use this; raw `loadYaml`
 * stays for commands that need to round-trip the file without
 * side-effects (e.g. `policy preset` writing it back).
 */
export function loadConfigWithPacks(path: string): {
  config: AgentGuardConfig;
  missingPacks: string[];
} {
  const raw = loadYaml<AgentGuardConfig>(path) ?? {};
  const extendsList = Array.isArray(raw.extends) ? raw.extends : [];
  if (extendsList.length === 0) {
    return { config: raw, missingPacks: [] };
  }
  const { rules: packRules, missing } = resolveExtends(extendsList);
  const combined: Rule[] = [...packRules, ...(raw.rules ?? [])];
  return {
    config: { ...raw, rules: combined },
    missingPacks: missing,
  };
}

/**
 * Load the host-policy floor from `~/.agentguard/host-policy.yaml`.
 * Returns an empty rule list if the file doesn't exist — most installs
 * won't have one. Host-policy supports `extends:` same as config.yaml
 * so operators can pin a preset floor (e.g. `filesystem-readonly`)
 * without duplicating the pack contents.
 *
 * The engine treats these rules as a floor: when a host rule and a
 * user rule both match a call, the stricter decision wins. A user
 * `config.yaml` cannot weaken a host-policy deny.
 */
export function loadHostPolicy(path: string = getHostPolicyPath()): {
  rules: Rule[];
  missingPacks: string[];
  path: string;
  exists: boolean;
} {
  if (!existsSync(path)) {
    return { rules: [], missingPacks: [], path, exists: false };
  }
  const raw = loadYaml<HostPolicy>(path) ?? {};
  const extendsList = Array.isArray(raw.extends) ? raw.extends : [];
  const ownRules = raw.rules ?? [];
  if (extendsList.length === 0) {
    return { rules: ownRules, missingPacks: [], path, exists: true };
  }
  const { rules: packRules, missing } = resolveExtends(extendsList);
  return {
    rules: [...packRules, ...ownRules],
    missingPacks: missing,
    path,
    exists: true,
  };
}
