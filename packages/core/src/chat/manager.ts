// packages/core/src/chat/manager.ts
import type { AgentBridge, ChatChannelId, ChatEvent, InboundChatMessage } from "./types.js";
import { SlidingWindowLimiter } from "./ratelimit.js";

export interface ChatAuditHook {
  (entry: { channel: ChatChannelId; sender: string; text: string; accepted: boolean; reason?: string }): void;
}

export interface ChatManagerOptions {
  bridge: AgentBridge;
  limits?: Partial<Record<ChatChannelId, { limit: number; windowMs: number }>>;
  onAudit?: ChatAuditHook;
  historySize?: number;
  queueDepth?: number;
  now?: () => Date;
}

/**
 * Routes inbound human messages to the agent bridge — one run at a time —
 * and fans the agent's reply stream out to subscribers (IPC, Telegram).
 * Enforces per-channel circuit-breaker rate limits. Tracks which channel
 * originated the ACTIVE run so the proxy can apply a channel policy floor.
 * INVARIANT: nothing in here mutates policy or config.
 */
export class ChatChannelManager {
  private readonly bridge: AgentBridge;
  private readonly limiters = new Map<ChatChannelId, SlidingWindowLimiter>();
  private readonly onAudit?: ChatAuditHook;
  private readonly historySize: number;
  private readonly queueDepth: number;
  private readonly now: () => Date;
  private readonly subscribers = new Set<(ev: ChatEvent) => void>();
  private readonly ring: ChatEvent[] = [];
  private readonly queue: InboundChatMessage[] = [];
  private active: ChatChannelId | null = null;

  constructor(opts: ChatManagerOptions) {
    this.bridge = opts.bridge;
    this.onAudit = opts.onAudit;
    this.historySize = opts.historySize ?? 200;
    this.queueDepth = opts.queueDepth ?? 5;
    this.now = opts.now ?? (() => new Date());
    for (const [channel, l] of Object.entries(opts.limits ?? {})) {
      if (l) this.limiters.set(channel as ChatChannelId, new SlidingWindowLimiter({ limit: l.limit, windowMs: l.windowMs, now: () => this.now().getTime() }));
    }
    this.bridge.onEvent((ev) => {
      const at = this.now().toISOString();
      if (ev.kind === "delta") this.emit({ kind: "assistant_delta", text: ev.text, at });
      else if (ev.kind === "final") this.emit({ kind: "assistant_final", text: ev.text, at });
      else if (ev.kind === "run_state" && (ev.state === "finished" || ev.state === "error")) {
        this.active = null;
        this.emit(ev.state === "error"
          ? { kind: "status", state: "offline", detail: ev.detail, at }
          : { kind: "status", state: "idle", at });
        this.drain();
      } else if (ev.kind === "connection") {
        this.emit({ kind: "status", state: ev.state === "up" ? "idle" : "offline", at });
      }
    });
  }

  subscribe(cb: (ev: ChatEvent) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private emit(ev: ChatEvent): void {
    this.ring.push(ev);
    while (this.ring.length > this.historySize) this.ring.shift();
    for (const cb of this.subscribers) {
      try { cb(ev); } catch { /* one bad subscriber must not break fan-out */ }
    }
  }

  history(limit?: number): ChatEvent[] {
    return limit ? this.ring.slice(-limit) : [...this.ring];
  }

  activeChannel(): ChatChannelId | null { return this.active; }

  status(): { bridgeUp: boolean; running: boolean; disarmed: ChatChannelId[]; queueDepth: number } {
    return {
      bridgeUp: this.bridge.isUp(),
      running: this.active !== null,
      disarmed: [...this.limiters.entries()].filter(([, l]) => l.disarmed).map(([c]) => c),
      queueDepth: this.queue.length,
    };
  }

  rearm(channel: ChatChannelId): void {
    this.limiters.get(channel)?.rearm();
  }

  handleInbound(msg: InboundChatMessage): { accepted: boolean; reason?: string } {
    const at = this.now().toISOString();
    const reject = (reason: string) => {
      this.onAudit?.({ channel: msg.channel, sender: msg.sender, text: msg.text, accepted: false, reason });
      this.emit({ kind: "rejected", channel: msg.channel, reason, at });
      return { accepted: false, reason };
    };
    if (!msg.text.trim()) return reject("empty");
    const limiter = this.limiters.get(msg.channel);
    if (limiter && !limiter.tryAcquire()) return reject("rate_limited");
    if (!this.bridge.isUp()) return reject("offline");
    if (this.queue.length >= this.queueDepth && this.active !== null) return reject("busy");
    this.onAudit?.({ channel: msg.channel, sender: msg.sender, text: msg.text, accepted: true });
    this.emit({ kind: "user", channel: msg.channel, text: msg.text, at });
    this.queue.push(msg);
    if (this.active === null) this.drain();
    return { accepted: true };
  }

  private drain(): void {
    const next = this.queue.shift();
    if (!next) return;
    this.active = next.channel;
    this.emit({ kind: "status", state: "running", channel: next.channel, at: this.now().toISOString() });
    void this.bridge.send(next.text).catch(() => {
      this.active = null;
      this.emit({ kind: "status", state: "offline", detail: "send failed", at: this.now().toISOString() });
    });
  }
}
