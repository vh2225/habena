import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Config-dir resolution mirrored from packages/core's paths.ts. The web
 * package can't import core, so this is duplicated at the package boundary —
 * keep the `~` expansion and precedence identical to core's expandHome()/getConfigDir().
 * (Within web, both audit.ts and approval-ipc.ts import from here — do not re-copy it.)
 */
export function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  if (p === "~") return homedir();
  return p;
}

export function configDir(): string {
  const override = process.env.HABENA_CONFIG_DIR ?? process.env.AGENTGUARD_CONFIG_DIR;
  if (override && override.trim() !== "") return expandHome(override.trim());
  const habena = join(homedir(), ".habena");
  if (existsSync(habena)) return habena;
  const legacy = join(homedir(), ".agentguard");
  if (existsSync(legacy)) return legacy;
  return habena;
}
