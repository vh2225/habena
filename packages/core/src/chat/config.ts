import type { AgentGuardConfig } from "../policy/types.js";

export interface ResolvedChatConfig {
  bridge: { kind: "openclaw"; url: string; token?: string; sessionKey: string };
  web: { enabled: boolean };
  telegram: { inbound: boolean; commandsPer10Min: number; policyFloor: string };
}

/** Normalize the user-facing chat config block. Null = chat feature off. */
export function resolveChatConfig(cfg: AgentGuardConfig): ResolvedChatConfig | null {
  const chat = cfg.chat;
  if (!chat?.enabled) return null;
  const b = chat.bridge;
  const token = b?.token ?? (b?.token_env ? process.env[b.token_env] : undefined);
  return {
    bridge: {
      kind: "openclaw",
      url: b?.url ?? "ws://127.0.0.1:18789",
      token,
      sessionKey: b?.session_key ?? "habena-chat",
    },
    web: { enabled: chat.channels?.web?.enabled ?? true },
    telegram: {
      inbound: chat.channels?.telegram?.inbound ?? false,
      commandsPer10Min: chat.channels?.telegram?.commands_per_10min ?? 10,
      policyFloor: chat.channels?.telegram?.policy_floor ?? "cautious",
    },
  };
}
