import type { RunnerContext } from "../context";

export async function open_page(
  ctx: RunnerContext,
  args: { url: string },
): Promise<void> {
  await ctx.page.goto(args.url, {
    timeout: ctx.navigationTimeoutMs,
    waitUntil: "domcontentloaded",
  });
}
