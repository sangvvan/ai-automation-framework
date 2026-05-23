import type { Locator } from "../../validation";
import type { RunnerContext } from "../context";
import { resolveLocator } from "../resolver";

export async function upload_file(
  ctx: RunnerContext,
  args: { target: Locator; filePath: string },
): Promise<void> {
  const loc = resolveLocator(ctx.page, args.target);
  await loc.first().setInputFiles(args.filePath, { timeout: ctx.stepTimeoutMs });
}
