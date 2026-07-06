/** Channel identifier for inbound chat messages. */
export type ChatChannelId = "web" | "telegram";

/** Inbound message from a user via a chat channel. */
export interface InboundChatMessage {
  channel: ChatChannelId;
  sender: string; // "local" for web; Telegram numeric user id as string
  text: string;
}

/** Outbound event from the agent bridge (LLM streaming + run state + connectivity). */
export type BridgeEvent =
  | { kind: "delta"; text: string }
  | { kind: "final"; text: string }
  | { kind: "run_state"; state: "started" | "finished" | "error"; detail?: string }
  | { kind: "connection"; state: "up" | "down" };

/** Agent bridge contract: start/stop, send messages, subscribe to events, check connectivity. */
export interface AgentBridge {
  readonly kind: string;
  start(): Promise<void>;
  send(text: string): Promise<void>;
  onEvent(cb: (ev: BridgeEvent) => void): () => void; // returns unsubscribe
  stop(): Promise<void>;
  isUp(): boolean;
}

/** Chat event emitted to audit log and UI (user input, assistant output, status transitions). */
export type ChatEvent =
  | { kind: "user"; channel: ChatChannelId; text: string; at: string }
  | { kind: "assistant_delta"; text: string; at: string }
  | { kind: "assistant_final"; text: string; at: string }
  | { kind: "status"; state: "idle" | "running" | "offline" | "disarmed"; channel?: ChatChannelId; detail?: string; at: string }
  | { kind: "rejected"; channel: ChatChannelId; reason: string; at: string };

/** Gateway bridge configuration (OpenClaw only in v1). */
export interface ChatBridgeConfig {
  kind: "openclaw";
  url?: string;         // default ws://127.0.0.1:18789
  token?: string;
  token_env?: string;   // env var name holding the gateway token
  session_key?: string; // default "habena-chat"
}

/** User-facing chat configuration block. */
export interface ChatConfig {
  enabled?: boolean;
  bridge?: ChatBridgeConfig;
  channels?: {
    web?: { enabled?: boolean };
    telegram?: {
      inbound?: boolean;              // default false
      commands_per_10min?: number;    // default 10
      policy_floor?: string;          // preset name, default "cautious"
    };
  };
}
