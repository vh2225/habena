import type { PolicyDecision } from "../policy/decisions.js";
import type { AggregatedTool } from "../downstream/types.js";
import { detectCredentialEgress } from "./credential-egress.js";
import { detectToolPoisoning } from "./tool-poisoning.js";
import { matchSignatures, type SignatureFeed } from "./signatures.js";
import type { ToolSnapshotStore } from "./snapshots.js";
import type { ThreatConfig, Finding, EnforcementMode, DetectorId, Severity } from "./types.js";

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/** A scan-time finding attributed to the public tool name it was found on. */
export interface ScanFinding extends Finding { tool: string }

export interface ScanSummary { scanned: number; flagged: number; findings: ScanFinding[] }

export class ThreatEngine {
  /** Per-tool flags discovered at scan time, applied at call time. key = `${server}/${tool}`.
   * Flags are STICKY for the session: a re-scan only ever adds flags. After a
   * drift is detected the new definition becomes the snapshot baseline, so a
   * later clean scan would otherwise silently unflag a rug-pulled tool. */
  private toolFlags = new Map<string, Finding[]>();

  constructor(
    private config: ThreatConfig,
    private snapshots: ToolSnapshotStore,
    /** Optional local signature feed (threat.feed_file). */
    private feed?: SignatureFeed | null
  ) {}

  /** Scan: poison (description) + drift (snapshot) per tool. Remembers flags;
   * returns a summary. Safe to re-run mid-session after a downstream refresh. */
  scanTools(tools: AggregatedTool[]): ScanSummary {
    const findings: ScanFinding[] = [];
    let flagged = 0;
    for (const t of tools) {
      const fs: Finding[] = [];
      if (this.config.tool_poisoning !== "off") fs.push(...detectToolPoisoning(t.description));
      if (this.config.rug_pull !== "off") {
        const drift = this.snapshots.checkAndRecord(t);
        if (drift) fs.push(drift);
      }
      if (this.feed && this.config.signatures !== "off") fs.push(...matchSignatures(this.feed, t));
      if (fs.length > 0) {
        this.toolFlags.set(`${t.server}/${t.originalName}`, fs);
        findings.push(...fs.map((f) => ({ ...f, tool: t.name })));
        flagged++;
      }
    }
    return { scanned: tools.length, flagged, findings };
  }

  /** Call-time check: egress on args + any remembered scan-time flag → a threat decision (or null). */
  checkCall(server: string, tool: string, args: Record<string, unknown>): PolicyDecision | null {
    const findings: Finding[] = [];
    if (this.config.credential_egress !== "off") findings.push(...detectCredentialEgress(args));
    const flags = this.toolFlags.get(`${server}/${tool}`);
    if (flags) findings.push(...flags);
    if (findings.length === 0) return null;

    let worst: Finding | null = null;
    for (const f of findings) {
      if (this.modeFor(f.detector) === "off") continue;
      if (!worst || SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst.severity]) worst = f;
    }
    if (!worst) return null;
    return this.toDecision(worst, tool);
  }

  private modeFor(d: DetectorId): EnforcementMode {
    return d === "tool_poisoning" ? this.config.tool_poisoning
      : d === "credential_egress" ? this.config.credential_egress
      : d === "signatures" ? this.config.signatures
      : this.config.rug_pull;
  }

  private toDecision(f: Finding, tool: string): PolicyDecision | null {
    const mode = this.modeFor(f.detector);
    const reason = `threat:${f.detector}: ${f.message}`;
    if (mode === "block") {
      return { action: "deny", reason, tool, enforcement: "hard_mandatory", risk_level: "critical", tier: "built_in" };
    }
    if (mode === "require_approval") {
      return { action: "require_approval", reason, tool, enforcement: "soft_mandatory", risk_level: f.severity === "low" ? "medium" : f.severity, tier: "built_in" };
    }
    if (mode === "warn") {
      return { action: "allow", reason, tool, enforcement: "advisory", risk_level: "low", tier: "built_in" };
    }
    return null;
  }
}
