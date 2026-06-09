import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { configDir } from "./config-dir";
import type { RegistryAgent } from "./agents";

interface RawAgent {
  name?: unknown;
  fingerprint?: unknown;
  registered?: unknown;
  mode?: unknown;
  permissions?: { budget?: { daily?: unknown } };
}

/** Pure: parse agents.yaml text → RegistryAgent[]. Never throws. */
export function parseRegistry(text: string | null): RegistryAgent[] {
  if (!text) return [];
  let doc: { agents?: Record<string, RawAgent> } | null = null;
  try {
    const v = parse(text);
    doc = v && typeof v === "object" ? (v as { agents?: Record<string, RawAgent> }) : null;
  } catch {
    return [];
  }
  const agents = doc?.agents;
  if (!agents || typeof agents !== "object") return [];
  return Object.entries(agents).map(([name, a]) => ({
    name: typeof a?.name === "string" ? a.name : name,
    mode: typeof a?.mode === "string" ? a.mode : "enforced",
    registered: typeof a?.registered === "string" ? a.registered : "",
    fingerprint: typeof a?.fingerprint === "string" ? a.fingerprint : "",
    budgetDaily: typeof a?.permissions?.budget?.daily === "number" ? a.permissions.budget.daily : null,
  }));
}

/** SERVER-ONLY IO: read agents.yaml from the config dir. */
export function readRegistry(): RegistryAgent[] {
  const p = join(configDir(), "agents.yaml");
  try {
    return parseRegistry(existsSync(p) ? readFileSync(p, "utf8") : null);
  } catch {
    return [];
  }
}
