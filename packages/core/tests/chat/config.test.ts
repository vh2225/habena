import { describe, it, expect, afterEach } from "vitest";
import { resolveChatConfig } from "../../src/chat/config.js";
import type { AgentGuardConfig } from "../../src/policy/types.js";

afterEach(() => { delete process.env.TEST_GW_TOKEN; });

describe("resolveChatConfig", () => {
  it("returns null when chat is absent or disabled", () => {
    expect(resolveChatConfig({} as AgentGuardConfig)).toBeNull();
    expect(resolveChatConfig({ chat: { enabled: false } } as AgentGuardConfig)).toBeNull();
  });

  it("applies defaults when chat is enabled", () => {
    const r = resolveChatConfig({ chat: { enabled: true } } as AgentGuardConfig);
    expect(r).toEqual({
      bridge: { kind: "openclaw", url: "ws://127.0.0.1:18789", token: undefined, sessionKey: "habena-chat" },
      web: { enabled: true },
      telegram: { inbound: false, commandsPer10Min: 10, policyFloor: "cautious" },
    });
  });

  it("reads the gateway token from token_env", () => {
    process.env.TEST_GW_TOKEN = "sekret";
    const r = resolveChatConfig({
      chat: { enabled: true, bridge: { kind: "openclaw", token_env: "TEST_GW_TOKEN" } },
    } as AgentGuardConfig);
    expect(r?.bridge.token).toBe("sekret");
  });

  it("explicit token wins over token_env; explicit fields override defaults", () => {
    const r = resolveChatConfig({
      chat: {
        enabled: true,
        bridge: { kind: "openclaw", url: "ws://127.0.0.1:9999", token: "abc", session_key: "s1" },
        channels: { web: { enabled: false }, telegram: { inbound: true, commands_per_10min: 3, policy_floor: "deny-all" } },
      },
    } as AgentGuardConfig);
    expect(r).toEqual({
      bridge: { kind: "openclaw", url: "ws://127.0.0.1:9999", token: "abc", sessionKey: "s1" },
      web: { enabled: false },
      telegram: { inbound: true, commandsPer10Min: 3, policyFloor: "deny-all" },
    });
  });
});
