/**
 * Per-host token bucket. Injectable clock + sleep so tests can run
 * deterministically against a virtual timeline (vi.useFakeTimers).
 */

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

interface Bucket {
  tokens: number;
  lastRefillAt: number;
}

export class PerHostRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly qps: number,
    private readonly clock: Clock = realClock,
  ) {}

  /** Block until a token is available for `host`. */
  async take(host: string): Promise<void> {
    const key = host.toLowerCase();
    for (;;) {
      this.refill(key);
      const b = this.buckets.get(key)!;
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(((1 - b.tokens) / this.qps) * 1000);
      await this.clock.sleep(Math.max(1, waitMs));
    }
  }

  private refill(host: string): void {
    const now = this.clock.now();
    const existing = this.buckets.get(host);
    if (!existing) {
      this.buckets.set(host, { tokens: this.qps, lastRefillAt: now });
      return;
    }
    const delta = (now - existing.lastRefillAt) / 1000;
    existing.tokens = Math.min(this.qps, existing.tokens + delta * this.qps);
    existing.lastRefillAt = now;
  }
}
