import { describe, expect, it } from "vitest";
import { PerHostRateLimiter, type Clock } from "./rate-limiter";

function virtualClock(): Clock & { advance: (ms: number) => void; t: number } {
  const state = { t: 0, queue: [] as Array<{ at: number; resolve: () => void }> };
  return {
    t: 0,
    now: () => state.t,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        state.queue.push({ at: state.t + ms, resolve });
        // Sort and fire any past-due timers immediately.
        state.queue.sort((a, b) => a.at - b.at);
      }),
    advance(ms) {
      state.t += ms;
      const ready = state.queue.filter((x) => x.at <= state.t);
      state.queue = state.queue.filter((x) => x.at > state.t);
      for (const r of ready) r.resolve();
    },
  };
}

describe("PerHostRateLimiter", () => {
  it("issues up to qps tokens immediately", async () => {
    const clk = virtualClock();
    const l = new PerHostRateLimiter(2, clk);
    await l.take("a");
    await l.take("a");
    // Third should wait for refill (~500ms at qps=2)
    let resolved = false;
    const p = l.take("a").then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    clk.advance(500);
    await p;
    expect(resolved).toBe(true);
  });

  it("per-host buckets are independent", async () => {
    const clk = virtualClock();
    const l = new PerHostRateLimiter(1, clk);
    await l.take("a");
    // host b still has a token even though a is exhausted
    let took = false;
    await l.take("b").then(() => (took = true));
    expect(took).toBe(true);
  });
});
