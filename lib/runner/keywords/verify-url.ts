import { expect } from "@playwright/test";
import type { RunnerContext } from "../context";

export async function verify_url(
  ctx: RunnerContext,
  args: { pattern: string },
): Promise<void> {
  const re = patternToRegex(args.pattern);
  await expect(ctx.page).toHaveURL(re, { timeout: ctx.stepTimeoutMs });
}

function patternToRegex(p: string): RegExp {
  // Treat plain substrings as substring matches; literal regex when wrapped /.../
  const m = p.match(/^\/(.+)\/([gimsuy]*)$/);
  if (m) return new RegExp(m[1], m[2]);

  // If the pattern contains common regex metacharacters like *, +, or |
  // we treat it as a direct regex pattern.
  if (/[\*+\|]/.test(p)) {
    try {
      return new RegExp(p);
    } catch {
      // If the regex is invalid, fall back to literal escaping
    }
  }
  return new RegExp(escapeRegex(p));
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

