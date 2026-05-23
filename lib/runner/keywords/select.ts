import type { Locator } from "../../validation";
import type { RunnerContext } from "../context";
import { resolveLocator } from "../resolver";

export async function select(
  ctx: RunnerContext,
  args: { target: Locator; value: string },
): Promise<void> {
  const loc = resolveLocator(ctx.page, args.target);
  await loc.first().selectOption(args.value, { timeout: ctx.stepTimeoutMs });
}
