/**
 * Sliding-window rate limiter that behaves like a circuit breaker: exceeding
 * the limit disarms the limiter entirely (everything rejected) until an
 * explicit rearm() from a trusted surface. See Phase 7 spec, "Circuit breakers".
 */
export class SlidingWindowLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private stamps: number[] = [];
  private tripped = false;

  constructor(opts: { limit: number; windowMs: number; now?: () => number }) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
  }

  get disarmed(): boolean {
    return this.tripped;
  }

  tryAcquire(): boolean {
    if (this.tripped) return false;
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < this.windowMs);
    if (this.stamps.length >= this.limit) {
      this.tripped = true;
      return false;
    }
    this.stamps.push(t);
    return true;
  }

  rearm(): void {
    this.tripped = false;
    this.stamps = [];
  }
}
