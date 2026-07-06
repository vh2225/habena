import { describe, it, expect } from "vitest";
import { SlidingWindowLimiter } from "../../src/chat/ratelimit.js";

describe("SlidingWindowLimiter", () => {
  it("allows up to limit within the window, then disarms", () => {
    let t = 0;
    const l = new SlidingWindowLimiter({ limit: 3, windowMs: 1000, now: () => t });
    expect(l.tryAcquire()).toBe(true);
    expect(l.tryAcquire()).toBe(true);
    expect(l.tryAcquire()).toBe(true);
    expect(l.tryAcquire()).toBe(false); // 4th trips the breaker
    expect(l.disarmed).toBe(true);
  });

  it("stays disarmed even after the window passes, until rearm()", () => {
    let t = 0;
    const l = new SlidingWindowLimiter({ limit: 1, windowMs: 1000, now: () => t });
    l.tryAcquire();
    l.tryAcquire(); // trips
    t = 10_000;     // window long gone
    expect(l.tryAcquire()).toBe(false);
    l.rearm();
    expect(l.disarmed).toBe(false);
    expect(l.tryAcquire()).toBe(true);
  });

  it("evicts entries older than the window before counting", () => {
    let t = 0;
    const l = new SlidingWindowLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect(l.tryAcquire()).toBe(true); // t=0
    t = 600;
    expect(l.tryAcquire()).toBe(true); // t=600
    t = 1100;                          // first entry expired
    expect(l.tryAcquire()).toBe(true); // still within limit
    expect(l.disarmed).toBe(false);
  });
});
