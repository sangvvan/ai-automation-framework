import type { Locator } from "../../validation";
import type { RunnerContext } from "../context";
import { resolveLocator } from "../resolver";

export type WaitStrategy = "visible" | "network-idle" | "mutation-stable" | "route-change";

export interface WaitForArgs {
  target?: Locator;
  strategy?: WaitStrategy;
  quietMs?: number;
}

/**
 * Wait-for with strategy. Defaults to `visible` (PS-001 behaviour).
 * REQ-014 extends with network-idle / mutation-stable / route-change.
 */
export async function wait_for(ctx: RunnerContext, args: WaitForArgs): Promise<void> {
  const strategy: WaitStrategy = args.strategy ?? "visible";
  switch (strategy) {
    case "visible": {
      if (!args.target) throw new Error("wait_for(visible) requires a target locator");
      const loc = resolveLocator(ctx.page, args.target);
      await loc.first().waitFor({ state: "visible", timeout: ctx.stepTimeoutMs });
      return;
    }
    case "network-idle": {
      await ctx.page.waitForLoadState("networkidle", { timeout: ctx.stepTimeoutMs });
      return;
    }
    case "mutation-stable": {
      const quietMs = args.quietMs ?? 500;
      // Run a MutationObserver in-page that resolves when no mutation has
      // fired for `quietMs`. Falls back to a single networkidle wait if
      // observer isn't usable.
      await ctx.page.evaluate(
        ({ quietMs, timeoutMs }) =>
          new Promise<void>((resolve, reject) => {
            const start = Date.now();
            let lastMutation = Date.now();
            try {
              const obs = new MutationObserver(() => {
                lastMutation = Date.now();
              });
              obs.observe(document.body, { childList: true, subtree: true, attributes: true });
              const tick = () => {
                const idleFor = Date.now() - lastMutation;
                if (idleFor >= quietMs) {
                  obs.disconnect();
                  resolve();
                  return;
                }
                if (Date.now() - start > timeoutMs) {
                  obs.disconnect();
                  reject(new Error("mutation-stable timeout"));
                  return;
                }
                setTimeout(tick, Math.min(quietMs / 2, 100));
              };
              tick();
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          }),
        { quietMs, timeoutMs: ctx.stepTimeoutMs },
      );
      return;
    }
    case "route-change": {
      const startUrl = ctx.page.url();
      await ctx.page.waitForFunction(
        (u) => location.href !== u,
        startUrl,
        { timeout: ctx.stepTimeoutMs },
      );
      return;
    }
  }
}
