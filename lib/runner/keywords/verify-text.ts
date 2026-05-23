import { expect } from "@playwright/test";
import type { Locator } from "../../validation";
import type { RunnerContext } from "../context";
import { resolveLocator } from "../resolver";

export async function verify_text(
  ctx: RunnerContext,
  args: { target?: Locator; text: string },
): Promise<void> {
  if (args.target) {
    const loc = resolveLocator(ctx.page, args.target);
    await expect(loc.first()).toContainText(args.text, { timeout: ctx.stepTimeoutMs });
  } else {
    await expect(ctx.page.locator("body")).toContainText(args.text, {
      timeout: ctx.stepTimeoutMs,
    });
  }
}
