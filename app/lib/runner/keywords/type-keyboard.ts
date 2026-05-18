import type { RunnerContext } from "../context";

export async function type_keyboard(
  ctx: RunnerContext,
  args: { keys: string },
): Promise<void> {
  // Comma-separated chord, e.g. 'Control+A' or 'Tab,Tab,Enter'.
  const seq = args.keys.split(",").map((s) => s.trim()).filter(Boolean);
  for (const k of seq) {
    await ctx.page.keyboard.press(k);
  }
}
