import type { Locator } from "../../validation";
import type { RunnerContext } from "../context";
import { resolveLocator } from "../resolver";

export async function scroll_to(
  ctx: RunnerContext,
  args: { target: Locator },
): Promise<void> {
  const loc = resolveLocator(ctx.page, args.target).first();
  await loc.scrollIntoViewIfNeeded({ timeout: ctx.stepTimeoutMs });
}
