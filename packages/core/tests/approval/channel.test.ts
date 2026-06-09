import { describe, it, expect, vi } from "vitest";
import {
  startChannels,
  stopChannels,
  type ApprovalChannel,
} from "../../src/approval/channel.js";

/** In-memory fake channel that records start/stop calls and can be made to throw. */
class FakeChannel implements ApprovalChannel {
  startCalls = 0;
  stopCalls = 0;
  constructor(
    public readonly name: string,
    private readonly opts: { failStart?: boolean; failStop?: boolean } = {}
  ) {}
  async start(): Promise<void> {
    this.startCalls++;
    if (this.opts.failStart) throw new Error(`${this.name} start boom`);
  }
  async stop(): Promise<void> {
    this.stopCalls++;
    if (this.opts.failStop) throw new Error(`${this.name} stop boom`);
  }
}

function silentLogger() {
  return { warn: vi.fn() };
}

describe("startChannels", () => {
  it("calls start() on every channel", async () => {
    const a = new FakeChannel("a");
    const b = new FakeChannel("b");
    await startChannels([a, b], silentLogger());
    expect(a.startCalls).toBe(1);
    expect(b.startCalls).toBe(1);
  });

  it("starts the others and does not throw when one channel's start() rejects", async () => {
    const a = new FakeChannel("a", { failStart: true });
    const b = new FakeChannel("b");
    const logger = silentLogger();

    await expect(startChannels([a, b], logger)).resolves.toBeUndefined();

    expect(a.startCalls).toBe(1);
    expect(b.startCalls).toBe(1); // b still started despite a failing
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain("a");
  });

  it("is a no-op for an empty channel list", async () => {
    const logger = silentLogger();
    await expect(startChannels([], logger)).resolves.toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("stopChannels", () => {
  it("calls stop() on every channel", async () => {
    const a = new FakeChannel("a");
    const b = new FakeChannel("b");
    await stopChannels([a, b]);
    expect(a.stopCalls).toBe(1);
    expect(b.stopCalls).toBe(1);
  });

  it("stops the others and does not throw when one channel's stop() rejects", async () => {
    const a = new FakeChannel("a", { failStop: true });
    const b = new FakeChannel("b");

    await expect(stopChannels([a, b])).resolves.toBeUndefined();

    expect(a.stopCalls).toBe(1);
    expect(b.stopCalls).toBe(1); // b still stopped despite a failing
  });

  it("is a no-op for an empty channel list", async () => {
    await expect(stopChannels([])).resolves.toBeUndefined();
  });
});
