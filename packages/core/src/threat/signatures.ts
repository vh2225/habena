import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";
import type { Finding, Severity } from "./types.js";
import type { AggregatedTool } from "../downstream/types.js";

/**
 * Local signature feed (`threat.feed_file`): a user-maintained YAML list of
 * known-bad MCP servers, tool-name patterns, and description substrings.
 * No cloud sync — the file is read once at startup. Format:
 *
 *   version: 1
 *   signatures:
 *     servers:
 *       - { name: evil-mcp, severity: critical, note: known-bad server }
 *     tools:
 *       - { pattern: "wallet_*", severity: high, note: drainer family }
 *     description_patterns:
 *       - { pattern: "upload your ssh key", severity: critical, note: exfil cue }
 */

export interface ServerSignature { name: string; severity: Severity; note?: string }
export interface PatternSignature { pattern: string; severity: Severity; note?: string }

export interface SignatureFeed {
  servers: ServerSignature[];
  tools: PatternSignature[];
  descriptionPatterns: PatternSignature[];
}

const SEVERITIES: ReadonlySet<string> = new Set(["low", "medium", "high", "critical"]);

function severity(v: unknown): Severity {
  return typeof v === "string" && SEVERITIES.has(v) ? (v as Severity) : "high";
}

/**
 * Load and validate a feed file. Returns null when the file doesn't exist;
 * throws on unparseable YAML (a present-but-broken feed should be loud, not
 * silently ignored). Individual malformed entries are skipped.
 */
export function loadSignatureFeed(path: string): SignatureFeed | null {
  if (!existsSync(path)) return null;
  const doc = parse(readFileSync(path, "utf8")) as {
    signatures?: {
      servers?: Array<Record<string, unknown>>;
      tools?: Array<Record<string, unknown>>;
      description_patterns?: Array<Record<string, unknown>>;
    };
  } | null;
  const sig = doc?.signatures ?? {};
  return {
    servers: (sig.servers ?? [])
      .filter((s) => typeof s?.name === "string" && s.name !== "")
      .map((s) => ({ name: s.name as string, severity: severity(s.severity), note: typeof s.note === "string" ? s.note : undefined })),
    tools: (sig.tools ?? [])
      .filter((s) => typeof s?.pattern === "string" && s.pattern !== "")
      .map((s) => ({ pattern: s.pattern as string, severity: severity(s.severity), note: typeof s.note === "string" ? s.note : undefined })),
    descriptionPatterns: (sig.description_patterns ?? [])
      .filter((s) => typeof s?.pattern === "string" && s.pattern !== "")
      .map((s) => ({ pattern: s.pattern as string, severity: severity(s.severity), note: typeof s.note === "string" ? s.note : undefined })),
  };
}

function matchesToolPattern(pattern: string, tool: string): boolean {
  if (pattern === "*" || pattern === tool) return true;
  if (pattern.endsWith("*")) return tool.startsWith(pattern.slice(0, -1));
  return false;
}

/** Scan-time check of one tool against the feed. */
export function matchSignatures(feed: SignatureFeed, tool: AggregatedTool): Finding[] {
  const findings: Finding[] = [];
  for (const s of feed.servers) {
    if (s.name === tool.server) {
      findings.push({
        detector: "signatures",
        severity: s.severity,
        message: `server "${tool.server}" is in the local signature feed${s.note ? `: ${s.note}` : ""}`,
      });
    }
  }
  for (const s of feed.tools) {
    if (matchesToolPattern(s.pattern, tool.originalName) || matchesToolPattern(s.pattern, tool.name)) {
      findings.push({
        detector: "signatures",
        severity: s.severity,
        message: `tool "${tool.name}" matches signature "${s.pattern}"${s.note ? `: ${s.note}` : ""}`,
      });
    }
  }
  const desc = (tool.description ?? "").toLowerCase();
  for (const s of feed.descriptionPatterns) {
    if (desc.includes(s.pattern.toLowerCase())) {
      findings.push({
        detector: "signatures",
        severity: s.severity,
        message: `tool "${tool.name}" description matches signature "${s.pattern}"${s.note ? `: ${s.note}` : ""}`,
      });
    }
  }
  return findings;
}
