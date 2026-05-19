import { readFile } from "node:fs/promises";
import path from "node:path";
import { analyzePage } from "../analyzer/analyze";
import { buildProvider } from "../ai/factory";
import { designScenarios } from "../ai/agents/test-design";
import type { FrameworkConfig } from "../config";
import { runScenarios } from "../runner/runner";
import { validateScenarioResult } from "../validator/validate";
import {
  SiteMap,
  type ExecutableScenario,
  type ExpectedResult,
  type ScenarioResult,
  type ValidationResult,
} from "../validation";

export interface OrchestrateOptions {
  siteMapPath: string;
  cfg: FrameworkConfig;
  runId: string;
  evidenceRoot: string;
  /** Use AI generation per page when true; otherwise fallback smoke. */
  explore?: boolean;
  /** Optional override of storageState (e.g. CLI flag). */
  storageStatePath?: string;
}

export interface PageRunBundle {
  scenarios: ExecutableScenario[];
  results: ScenarioResult[];
  validations: ValidationResult[];
  pageHash: string;
  pageUrl: string;
}

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";

export async function orchestrateSiteMap(
  opts: OrchestrateOptions,
): Promise<PageRunBundle[]> {
  const raw = await readFile(opts.siteMapPath, "utf8");
  const sm = SiteMap.parse(JSON.parse(raw));

  const storageStatePath = opts.storageStatePath ?? sm.storageStatePath;

  const bundles: PageRunBundle[] = [];

  for (const page of sm.pages) {
    const pageHash = createHash("sha1")
      .update(page.normalizedUrl)
      .digest("hex")
      .slice(0, 10);
    const pageDir = path.join(opts.evidenceRoot, pageHash);
    await mkdir(pageDir, { recursive: true });

    try {
      const analysis = await analyzePage({
        url: page.normalizedUrl,
        viewport: opts.cfg.runner.viewport,
        screenshotPath: path.join(pageDir, "page.png"),
        headless: opts.cfg.runner.headless,
        navigationTimeoutMs: opts.cfg.runner.navigationTimeoutMs,
        storageStatePath,
      });

      let scenarios: ExecutableScenario[] = [];
      if (opts.explore) {
        const provider = buildProvider({
          config: opts.cfg,
          role: "design",
          tracePath: path.join(pageDir, "ai-trace.jsonl"),
        });
        try {
          scenarios = await designScenarios({
            analysis,
            provider,
            maxScenarios: opts.cfg.generation.maxScenarios,
            categories: opts.cfg.generation.categories,
          });
        } catch (err) {
          process.stderr.write(
            `Warning [${page.normalizedUrl}]: AI gen unavailable (${(err as Error).message}); using smoke scenario.\n`,
          );
          scenarios = [smokeScenario(page.normalizedUrl, opts.runId, pageHash, analysis.finalUrl)];
        }
      } else {
        scenarios = [smokeScenario(page.normalizedUrl, opts.runId, pageHash, analysis.finalUrl)];
      }

      const results = await runScenarios(scenarios, {
        headless: opts.cfg.runner.headless,
        stepTimeoutMs: opts.cfg.runner.stepTimeoutMs,
        navigationTimeoutMs: opts.cfg.runner.navigationTimeoutMs,
        viewport: opts.cfg.runner.viewport,
        evidenceDir: pageDir,
        captureScreenshotOnSuccess: opts.cfg.runner.captureScreenshotOnSuccess,
        storageStatePath,
      });

      const validations = results.map((r, i) =>
        validateScenarioResult(r, scenarios[i].expectedResult),
      );

      bundles.push({
        scenarios,
        results,
        validations,
        pageHash,
        pageUrl: page.normalizedUrl,
      });
    } catch (err) {
      process.stderr.write(
        `Skipping page ${page.normalizedUrl}: ${(err as Error).message}\n`,
      );
      continue;
    }
  }

  return bundles;
}

function smokeScenario(
  url: string,
  runId: string,
  pageHash: string,
  expectedUrl: string,
): ExecutableScenario {
  const expectedResult: ExpectedResult = { url: expectedUrl };
  return {
    id: `EXPLORE_${runId}_${pageHash}`,
    title: `Open ${url} and verify it loads`,
    type: "navigation",
    priority: "P2",
    pageUrl: url,
    origin: "ai-generated",
    steps: [
      {
        index: 0,
        description: `Open ${url}`,
        action: { keyword: "open_page", url },
        resolved: true,
      },
    ],
    expectedResult,
    warnings: [],
  };
}
