import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Finding } from "./types.js";

interface Snapshot { hash: string; firstSeen: string; lastSeen: string; }
interface ToolLike { server: string; originalName: string; description?: string; inputSchema?: unknown; }

export function hashToolDef(description: string | undefined, inputSchema: unknown): string {
  const material = JSON.stringify({ d: description ?? "", s: inputSchema ?? null });
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

/** Persists per-tool definition hashes so a "rug pull" (changed tool) is detectable. */
export class ToolSnapshotStore {
  private snaps: Record<string, Snapshot>;

  constructor(private path: string) {
    this.snaps = this.load();
  }

  private load(): Record<string, Snapshot> {
    try {
      if (!existsSync(this.path)) return {};
      const v = JSON.parse(readFileSync(this.path, "utf8"));
      return v && typeof v === "object" ? (v as Record<string, Snapshot>) : {};
    } catch {
      return {};
    }
  }

  private save(): void {
    try {
      writeFileSync(this.path, JSON.stringify(this.snaps, null, 2), "utf8");
    } catch {
      /* best-effort; drift detection degrades but never crashes a call */
    }
  }

  /** Record the tool; return a drift Finding if a previously-seen def changed. */
  checkAndRecord(tool: ToolLike): Finding | null {
    const key = `${tool.server}/${tool.originalName}`;
    const hash = hashToolDef(tool.description, tool.inputSchema);
    const now = new Date().toISOString();
    const prev = this.snaps[key];
    if (!prev) {
      this.snaps[key] = { hash, firstSeen: now, lastSeen: now };
      this.save();
      return null;
    }
    if (prev.hash !== hash) {
      this.snaps[key] = { hash, firstSeen: prev.firstSeen, lastSeen: now };
      this.save();
      return {
        detector: "rug_pull",
        severity: "high",
        message: `tool definition changed since first seen (possible rug-pull): ${key}`,
        evidence: `was:${prev.hash} now:${hash}`,
      };
    }
    this.snaps[key] = { ...prev, lastSeen: now };
    this.save();
    return null;
  }
}
