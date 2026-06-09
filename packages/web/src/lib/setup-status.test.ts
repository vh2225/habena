import { describe, it, expect } from "vitest";
import { parseSetupStatus, downstreamAddCommand, agentAddCommand } from "./setup-status";

describe("parseSetupStatus", () => {
  it("reports not-configured when config is absent", () => {
    const s = parseSetupStatus({ configExists: false, configText: null, agentsText: null, proxyRunning: false, decisionCount: 0 });
    expect(s).toEqual({ configExists: false, downstreams: [], agents: [], telegramConfigured: false, proxyRunning: false, decisionCount: 0 });
  });

  it("extracts downstream + telegram from config.yaml and agents from agents.yaml", () => {
    const configText = [
      "mcp_servers:",
      "  filesystem:",
      "    command: npx",
      "approval:",
      "  channels:",
      "    telegram:",
      "      owner_id: 123",
    ].join("\n");
    const agentsText = "agents:\n  openclaw:\n    name: openclaw\n";
    const s = parseSetupStatus({ configExists: true, configText, agentsText, proxyRunning: true, decisionCount: 4 });
    expect(s.configExists).toBe(true);
    expect(s.downstreams).toEqual(["filesystem"]);
    expect(s.telegramConfigured).toBe(true);
    expect(s.agents).toEqual(["openclaw"]);
    expect(s.proxyRunning).toBe(true);
    expect(s.decisionCount).toBe(4);
  });

  it("treats empty agents.yaml ({}) as no agents and missing telegram as false", () => {
    const s = parseSetupStatus({ configExists: true, configText: "mcp_servers: {}\n", agentsText: "agents: {}\n", proxyRunning: false, decisionCount: 0 });
    expect(s.downstreams).toEqual([]);
    expect(s.agents).toEqual([]);
    expect(s.telegramConfigured).toBe(false);
  });

  it("never throws on malformed yaml — degrades to empty/false", () => {
    const s = parseSetupStatus({ configExists: true, configText: ":::not yaml:::\n  - [", agentsText: "also bad: [", proxyRunning: false, decisionCount: 0 });
    expect(s.configExists).toBe(true);
    expect(s.downstreams).toEqual([]);
    expect(s.agents).toEqual([]);
    expect(s.telegramConfigured).toBe(false);
  });
});

describe("command builders", () => {
  it("downstreamAddCommand quotes the path", () => {
    expect(downstreamAddCommand("~/workspace")).toBe("habena downstream add filesystem ~/workspace");
    expect(downstreamAddCommand("/my dir")).toBe('habena downstream add filesystem "/my dir"');
  });
  it("agentAddCommand includes name + daily budget", () => {
    expect(agentAddCommand("openclaw", 30)).toBe("habena agent add --name openclaw --budget-daily 30");
  });
});
