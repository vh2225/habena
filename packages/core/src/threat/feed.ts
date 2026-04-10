/**
 * Threat feed sync — periodically downloads threat intelligence
 * from AgentGuard cloud and caches locally.
 * Similar to antivirus signature updates.
 */

import { readFile, writeFile } from "node:fs/promises";

export interface ThreatEntry {
  type: "blocklisted_server" | "advisory" | "pattern" | "anomaly";
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  /** For blocklisted_server: the server name/URL */
  target?: string;
  /** For pattern: regex to match against tool args */
  pattern?: string;
  /** For advisory: affected tool versions */
  affectedVersions?: string[];
  publishedAt: Date;
  expiresAt?: Date;
}

export interface ThreatFeed {
  lastSynced: Date;
  entries: ThreatEntry[];
  version: string;
}

const FEED_CACHE_PATH = "~/.agentguard/threat-feed.json";

export class ThreatFeedManager {
  private feed: ThreatFeed | null = null;
  private syncIntervalMs: number;

  constructor(tier: "free" | "pro" | "team") {
    this.syncIntervalMs = {
      free: 24 * 60 * 60 * 1000,   // 24 hours
      pro: 6 * 60 * 60 * 1000,     // 6 hours
      team: 5 * 60 * 1000,         // 5 minutes (near real-time)
    }[tier];
  }

  async loadLocal(): Promise<ThreatFeed | null> {
    // TODO: Read cached threat-feed.json
    throw new Error("Not implemented");
  }

  async sync(): Promise<void> {
    // TODO: Fetch latest feed from AgentGuard cloud API
    // TODO: Merge with local cache
    // TODO: Write updated feed to disk
  }

  isStale(): boolean {
    if (!this.feed) return true;
    return Date.now() - this.feed.lastSynced.getTime() > this.syncIntervalMs;
  }

  getEntries(): ThreatEntry[] {
    return this.feed?.entries ?? [];
  }

  startAutoSync(): void {
    // TODO: Set up periodic sync interval
  }
}
