import { describe, it, expect } from "vitest";
import { resolveThreatConfig, DEFAULT_THREAT_CONFIG } from "../../src/threat/types.js";

describe("resolveThreatConfig", () => {
  it("applies require_approval defaults when no config is given", () => {
    expect(resolveThreatConfig(undefined)).toEqual({
      tool_poisoning: "require_approval",
      credential_egress: "require_approval",
      rug_pull: "require_approval",
      rescan_interval: "10m",
    });
    expect(DEFAULT_THREAT_CONFIG.credential_egress).toBe("require_approval");
  });

  it("lets a partial config override individual detectors", () => {
    expect(resolveThreatConfig({ credential_egress: "block", rug_pull: "off" })).toEqual({
      tool_poisoning: "require_approval",
      credential_egress: "block",
      rug_pull: "off",
      rescan_interval: "10m",
    });
  });

  it("ignores invalid enforcement values, falling back to the default", () => {
    // @ts-expect-error testing runtime guard against bad yaml
    expect(resolveThreatConfig({ tool_poisoning: "nonsense" }).tool_poisoning).toBe("require_approval");
  });

  it("accepts a rescan_interval override (including 'off') and rejects blanks", () => {
    expect(resolveThreatConfig({ rescan_interval: "30m" }).rescan_interval).toBe("30m");
    expect(resolveThreatConfig({ rescan_interval: "off" }).rescan_interval).toBe("off");
    expect(resolveThreatConfig({ rescan_interval: "  " }).rescan_interval).toBe("10m");
    // @ts-expect-error testing runtime guard against bad yaml
    expect(resolveThreatConfig({ rescan_interval: 5 }).rescan_interval).toBe("10m");
  });
});
