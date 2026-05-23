import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { RunnerContext } from "../context";
import {
  diffScreenshots,
  lookupBaseline,
  writeBaseline,
  type BaselineMetadata,
} from "../baseline-store";
import type { Page } from "@playwright/test";

export interface VerifyScreenshotArgs {
  name: string;
  /** Pixel-delta fail threshold (ratio 0..1). Default 0.001 (0.1%). */
  threshold?: number;
  /** Browser tag (for grouping in baselines).Default 'chromium'. */
  browser?: string;
}

export interface VerifyScreenshotEnv {
  baselinesRoot: string;
  evidenceDir: string;
  suiteSlug: string;
  scenarioId: string;
  /** Sensitive-field selector hints to blur before capture. */
  sensitiveSelectors?: string[];
}

export interface VerifyScreenshotOutcome {
  status: "passed" | "failed";
  reason?: string;
  baselineWritten: boolean;
  pixelDeltaRatio?: number;
  diffPath?: string;
}

/**
 * Compare the current page screenshot against a saved baseline. On the
 * first run, captures the baseline and passes with `baselineWritten:true`.
 * Subsequent runs diff against the baseline; pass when delta < threshold.
 *
 * Sensitive fields (from PageAnalysis.isSensitive heuristics) are blurred
 * before capture so passwords / tokens don't leak into the baseline PNG.
 */
export async function verify_screenshot(
  ctx: RunnerContext & { env?: VerifyScreenshotEnv },
  args: VerifyScreenshotArgs,
): Promise<VerifyScreenshotOutcome> {
  if (!ctx.env) {
    return {
      status: "failed",
      reason: "verify_screenshot requires runner env (baselinesRoot, evidenceDir)",
      baselineWritten: false,
    };
  }
  const env = ctx.env;
  const threshold = args.threshold ?? 0.001;
  const lookup = await lookupBaseline({
    baselinesRoot: env.baselinesRoot,
    evidenceDir: env.evidenceDir,
    suiteSlug: env.suiteSlug,
    scenarioId: env.scenarioId,
    shotName: args.name,
  });

  // Blur sensitive fields before capture (per ADR-011).
  if (env.sensitiveSelectors?.length) {
    await blurSensitive(ctx.page, env.sensitiveSelectors).catch(() => undefined);
  }

  const candidatePath = path.join(
    env.evidenceDir,
    `screenshot-${args.name}.png`,
  );
  await mkdir(env.evidenceDir, { recursive: true });
  await ctx.page.screenshot({ path: candidatePath, fullPage: false });

  if (!lookup.exists) {
    const meta: BaselineMetadata = {
      capturedAt: new Date().toISOString(),
      viewport: ctx.page.viewportSize() ?? { width: 1280, height: 800 },
      browser: args.browser ?? "chromium",
      threshold,
    };
    await writeBaseline(lookup.paths, candidatePath, meta);
    return { status: "passed", baselineWritten: true };
  }

  const diff = await diffScreenshots(
    lookup.paths.baselinePath,
    candidatePath,
    lookup.paths.diffPath,
    threshold,
  );

  if (diff.pixelDeltaRatio >= threshold) {
    return {
      status: "failed",
      reason: `screenshot-diff: ${(diff.pixelDeltaRatio * 100).toFixed(3)}% > threshold ${(threshold * 100).toFixed(3)}%`,
      baselineWritten: false,
      pixelDeltaRatio: diff.pixelDeltaRatio,
      diffPath: diff.diffWritten ? lookup.paths.diffPath : undefined,
    };
  }
  return {
    status: "passed",
    baselineWritten: false,
    pixelDeltaRatio: diff.pixelDeltaRatio,
  };
}

async function blurSensitive(page: Page, selectors: string[]): Promise<void> {
  // Add a tiny overlay style for each match, then revert after capture
  // is the cleanest approach — but Playwright captures synchronously,
  // so we just style elements and trust the caller to navigate before
  // the next scenario. (Page lifetime is one scenario in our runner.)
  await page.evaluate((sels) => {
    for (const s of sels) {
      document.querySelectorAll(s).forEach((el) => {
        (el as HTMLElement).style.filter = "blur(6px)";
        (el as HTMLElement).setAttribute("data-ai-test-blurred", "1");
      });
    }
  }, selectors);
}
