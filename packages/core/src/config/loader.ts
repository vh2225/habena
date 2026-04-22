import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";
import type { AgentGuardConfig, Rule } from "../policy/types.js";
import { resolveExtends } from "../policy/packs.js";

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
