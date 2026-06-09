/**
 * An ApprovalChannel is a lifecycle-managed delivery surface for human
 * approval requests (e.g. Telegram, Slack, a web push). A channel is
 * constructed elsewhere with whatever it needs (typically a reference to the
 * ApprovalQueue, which it subscribes to and answers via). This interface only
 * governs lifecycle — start it when the proxy boots, stop it on shutdown.
 *
 * Deliberately minimal (YAGNI): no registry / plugin system here. Channels are
 * instantiated explicitly where their config lives.
 */
export interface ApprovalChannel {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Minimal logger surface the orchestration helpers need. */
export interface ChannelLogger {
  warn(message: string): void;
}

/**
 * Start every channel best-effort. A channel that throws on start() must NOT
 * prevent the others from starting and must NOT propagate — it's logged as a
 * warning and we continue (mirrors the IPC-start handling in start.ts: a broken
 * notification surface should never take down the proxy).
 */
export async function startChannels(
  channels: ApprovalChannel[],
  logger: ChannelLogger
): Promise<void> {
  await Promise.all(
    channels.map((c) =>
      c.start().catch((err: unknown) => {
        logger.warn(
          `! Failed to start approval channel "${c.name}": ${(err as Error).message}`
        );
      })
    )
  );
}

/**
 * Stop every channel best-effort. Cleanup errors are swallowed — shutdown
 * should not be blocked or fail because a channel couldn't close cleanly.
 */
export async function stopChannels(channels: ApprovalChannel[]): Promise<void> {
  await Promise.all(channels.map((c) => c.stop().catch(() => {})));
}
