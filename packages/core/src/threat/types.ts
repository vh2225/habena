export type Severity = "low" | "medium" | "high" | "critical";
export type EnforcementMode = "off" | "warn" | "require_approval" | "block";
export type DetectorId = "tool_poisoning" | "credential_egress" | "rug_pull";

export interface Finding {
  detector: DetectorId;
  severity: Severity;
  message: string;
  /** Short, redacted evidence — MUST NOT echo a full secret. */
  evidence?: string;
}

export interface ThreatConfig {
  tool_poisoning: EnforcementMode;
  credential_egress: EnforcementMode;
  rug_pull: EnforcementMode;
  /** Optional local signature file (no cloud sync). Unused in v1's detectors. */
  feed_file?: string;
}

export const DEFAULT_THREAT_CONFIG: ThreatConfig = {
  tool_poisoning: "require_approval",
  credential_egress: "require_approval",
  rug_pull: "require_approval",
};

const VALID: ReadonlySet<EnforcementMode> = new Set(["off", "warn", "require_approval", "block"]);

function mode(v: unknown, fallback: EnforcementMode): EnforcementMode {
  return typeof v === "string" && VALID.has(v as EnforcementMode) ? (v as EnforcementMode) : fallback;
}

/** Build a full ThreatConfig from a (possibly partial / untrusted) config.yaml section. */
export function resolveThreatConfig(partial: Partial<ThreatConfig> | undefined): ThreatConfig {
  const p = partial ?? {};
  return {
    tool_poisoning: mode(p.tool_poisoning, DEFAULT_THREAT_CONFIG.tool_poisoning),
    credential_egress: mode(p.credential_egress, DEFAULT_THREAT_CONFIG.credential_egress),
    rug_pull: mode(p.rug_pull, DEFAULT_THREAT_CONFIG.rug_pull),
    ...(typeof p.feed_file === "string" ? { feed_file: p.feed_file } : {}),
  };
}
