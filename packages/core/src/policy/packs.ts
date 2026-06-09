import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { getConfigDir } from "../config/paths.js";
import type { Rule } from "./types.js";

export interface RulePack {
  name: string;
  description?: string;
  server?: string;
  rules: Rule[];
  /** Filesystem path this pack was loaded from, for error messages. */
  source: string;
}

/**
 * Rule packs ship with the package (packages/core/rule-packs/) AND can be
 * authored by the user (~/.habena/rule-packs/, or legacy ~/.agentguard/).
 * User packs with the same name override shipped ones.
 */
export function packSearchDirs(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  // Shipped: dist/policy/packs.js → ../../rule-packs/
  const shippedDir = join(here, "..", "..", "rule-packs");
  const userDir = join(getConfigDir(), "rule-packs");
  return [shippedDir, userDir];
}

export function listPacks(dirs: string[] = packSearchDirs()): RulePack[] {
  const byName = new Map<string, RulePack>();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".yaml") && !f.endsWith(".yml")) continue;
      const path = join(dir, f);
      const loaded = tryLoadPack(path);
      if (loaded) byName.set(loaded.name, loaded);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getPack(name: string, dirs: string[] = packSearchDirs()): RulePack | undefined {
  // User dir takes precedence: iterate in reverse.
  for (const dir of [...dirs].reverse()) {
    const candidate = join(dir, `${name}.yaml`);
    if (existsSync(candidate)) return tryLoadPack(candidate);
    const alt = join(dir, `${name}.yml`);
    if (existsSync(alt)) return tryLoadPack(alt);
  }
  return undefined;
}

function tryLoadPack(path: string): RulePack | undefined {
  try {
    const raw = parseYaml(readFileSync(path, "utf8")) as Partial<RulePack>;
    if (!raw || typeof raw !== "object") return undefined;
    const name = typeof raw.name === "string" && raw.name.length > 0
      ? raw.name
      : basename(path).replace(/\.ya?ml$/, "");
    const rules = Array.isArray(raw.rules) ? (raw.rules as Rule[]) : [];
    return {
      name,
      description: typeof raw.description === "string" ? raw.description : undefined,
      server: typeof raw.server === "string" ? raw.server : undefined,
      rules,
      source: path,
    };
  } catch {
    return undefined;
  }
}

/**
 * Resolve `extends: [<pack-name>, ...]` inside a config into a rule list.
 * Pack rules come first in the output; user's own rules (if any) come
 * after in `expandExtends`'s callers. First-match-wins per the engine's
 * existing semantics means user rules still take precedence for any
 * tool they explicitly rule on.
 */
export function resolveExtends(
  names: string[],
  dirs: string[] = packSearchDirs()
): { rules: Rule[]; missing: string[] } {
  const rules: Rule[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const pack = getPack(name, dirs);
    if (!pack) {
      missing.push(name);
      continue;
    }
    rules.push(...pack.rules);
  }
  return { rules, missing };
}
