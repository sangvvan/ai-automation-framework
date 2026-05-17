import type { Locator } from "../../validation";
import type { RunnerContext } from "../context";
import { resolveLocator } from "../resolver";

export async function wait_for(
  ctx: RunnerContext,
  args: { target: Locator },
): Promise<void> {
  const loc = resolveLocator(ctx.page, args.target);
  await loc.first().waitFor({ state: "visible", timeout: ctx.stepTimeoutMs });
}
