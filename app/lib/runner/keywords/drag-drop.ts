import type { Locator } from "../../validation";
import type { RunnerContext } from "../context";
import { resolveLocator } from "../resolver";

export async function drag_drop(
  ctx: RunnerContext,
  args: { source: Locator; target: Locator },
): Promise<void> {
  const src = resolveLocator(ctx.page, args.source).first();
  const dst = resolveLocator(ctx.page, args.target).first();
  await src.dragTo(dst, { timeout: ctx.stepTimeoutMs });
}
