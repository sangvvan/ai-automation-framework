import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../../config";
import { flagBool, flagString } from "../args";
import { generateRunId } from "../run-id";
import type { CliCommand } from "../commands";
import { parseTestCaseFile } from "../../scenario/parse";
import { mapStepsToActions } from "../../scenario/step-mapper";
import { analyzePage } from "../../analyzer/analyze";
import { runScenarios } from "../../runner/runner";
import { validateScenarioResult } from "../../validator/validate";
import { writeJsonReport } from "../../reporter/json";
import { writeHtmlReport } from "../../reporter/html";
import { writeJunitReport } from "../../reporter/junit";
import { generateAndWriteTestPlan } from "../../reporter/test-plan-generator";
import { assembleSuites } from "../../review/suite-assembler";
import {
  ExecutableScenario,
  RunSummary,
  type ScenarioResult,
  type ValidationResult,
  type RunSummary as RunSummaryT,
} from "../../validation";
import type { BrowserName } from "../../browser/launcher";

/**
 * Re-run scenarios that failed in a previous run, or a hand-picked list
 * of test case ids. Closes the loop Codex's design proposed
 * (`--from <runId> --failed-only` / `--testcases id,id`).
 *
 * Mechanics:
 *  1. Load the prior RunSummary at `reports/json/<runId>.json`.
 *  2. Pick scenarios:
 *     - `--failed-only` → status === 'failed'.
 *     - `--testcases id,id` → exact bare-id match (run-id prefix stripped).
 *     - default (neither) → re-run every scenario.
 *  3. Re-analyse each scenario's pageUrl, re-map steps, re-execute via
 *     the existing runner pipeline.
 *  4. Emit a fresh report bundle (JSON / HTML / JUnit / TestPlan) under
 *     a new runId so the original run is preserved.
 */
export const rerunCommand: CliCommand = {
  help: {
    name: "rerun",
    summary: "Re-execute scenarios from a previous run (failed-only or by id list).",
    example: "ai-test rerun --from R-20260519-... --failed-only",
    options: [
      { flag: "--from", description: "Source run id OR path to RunSummary JSON (required)" },
      { flag: "--failed-only", description: "Re-run only scenarios that failed in the source" },
      { flag: "--testcases", description: "Comma-separated bare scenario ids to re-run" },
      { flag: "--storage-state", description: "Override storageState path" },
      {
        flag: "--browsers",
        description: "Comma-separated browsers: chromium,firefox,webkit",
        default: "chromium",
      },
      { flag: "--locales", description: "Comma-separated BCP-47 locales (e.g. en,vi,ja)" },
      { flag: "--a11y", description: "Run axe-core per scenario (boolean)" },
      { flag: "--vitals", description: "Capture Web Vitals per scenario (boolean)" },
      { flag: "--security-headers", description: "Validate response headers per nav (boolean)" },
      { flag: "--suite-tag", description: "Suite tag for regression diff" },
      { flag: "--no-junit", description: "Skip JUnit XML output" },
      { flag: "--no-test-plan", description: "Skip TestPlan generation" },
    ],
  },
  run: async (args) => {
    const from = flagString(args, "from");
    if (!from) {
      process.stderr.write("Missing --from <runId>|<path>\n");
      return 1;
    }
    const failedOnly = flagBool(args, "failed-only");
    const testcasesFlag = flagString(args, "testcases");
    const explicitIds = testcasesFlag
      ? new Set(testcasesFlag.split(",").map((s) => s.trim()).filter(Boolean))
      : undefined;

    const cfg = loadConfig();

    // Resolve --from to a RunSummary JSON path.
    const sourcePath = resolveRunPath(from, cfg.reportsDir);
    if (!existsSync(sourcePath)) {
      process.stderr.write(
        `rerun: source run not found at ${sourcePath}\n` +
          `Tip: pass the run id (e.g. R-20260519-...) or a full path.\n`,
      );
      return 2;
    }
    const source = RunSummary.parse(JSON.parse(await readFile(sourcePath, "utf8")));

    // Pick which scenarios to re-execute.
    const candidates = source.scenarios.filter((s) => {
      if (explicitIds) return explicitIds.has(s.scenario.id) || explicitIds.has(bareId(s.scenario.id));
      if (failedOnly) return s.validation.status === "failed";
      return true;
    });
    if (candidates.length === 0) {
      process.stdout.write(
        `rerun: no scenarios match the filter (failed-only=${failedOnly}, testcases=${testcasesFlag ?? "—"}).\n`,
      );
      return 0;
    }

    process.stdout.write(
      `Re-running ${candidates.length} of ${source.scenarios.length} scenario(s) from ${source.runId}\n`,
    );

    // Group by pageUrl so we analyse each page once.
    const byUrl = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const k = c.scenario.pageUrl;
      const arr = byUrl.get(k) ?? [];
      arr.push(c);
      byUrl.set(k, arr);
    }

    const runId = generateRunId();
    const evidenceDir = path.join(cfg.evidenceDir, runId);
    const browsersFlag = flagString(args, "browsers") ?? "chromium";
    const browsers = browsersFlag
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as BrowserName[];
    const localesFlag = flagString(args, "locales");
    const locales = localesFlag
      ? localesFlag.split(",").map((s) => s.trim()).filter(Boolean)
      : [undefined];
    const storageStatePath = flagString(args, "storage-state");
    const nonFunctional = {
      a11y: flagBool(args, "a11y"),
      vitals: flagBool(args, "vitals"),
      securityHeaders: flagBool(args, "security-headers"),
    };

    const allScenarios: ExecutableScenario[] = [];
    const allResults: ScenarioResult[] = [];
    const allValidations: ValidationResult[] = [];

    for (const [url, bundle] of byUrl) {
      const pageDir = path.join(evidenceDir, hashUrl(url));
      const analysis = await analyzePage({
        url,
        viewport: cfg.runner.viewport,
        screenshotPath: path.join(pageDir, "page.png"),
        headless: cfg.runner.headless,
        navigationTimeoutMs: cfg.runner.navigationTimeoutMs,
      });
      const remapped: ExecutableScenario[] = bundle.map((b) => {
        const mapped = mapStepsToActions(b.scenario.steps, analysis, b.scenario.pageUrl);
        return ExecutableScenario.parse({
          ...b.scenario,
          steps: mapped.steps,
          warnings: [...(b.scenario.warnings ?? []), ...mapped.warnings],
        });
      });
      for (const browser of browsers) {
        for (const locale of locales) {
          const tag =
            (browsers.length > 1 ? `-${browser}` : "") +
            (locale && locales.length > 1 ? `-${locale}` : "");
          const tagged = tag
            ? remapped.map((s) => ({ ...s, id: `${s.id}${tag}` }))
            : remapped;
          const outcome = await runScenarios(tagged, {
            headless: cfg.runner.headless,
            stepTimeoutMs: cfg.runner.stepTimeoutMs,
            navigationTimeoutMs: cfg.runner.navigationTimeoutMs,
            viewport: cfg.runner.viewport,
            evidenceDir: pageDir,
            captureScreenshotOnSuccess: cfg.runner.captureScreenshotOnSuccess,
            browser,
            locale,
            storageStatePath,
            nonFunctional,
          });
          allScenarios.push(...tagged);
          allResults.push(...outcome.results);
          allValidations.push(
            ...outcome.results.map((r, i) =>
              validateScenarioResult(r, tagged[i].expectedResult),
            ),
          );
        }
      }
    }

    const totals = {
      total: allScenarios.length,
      passed: allValidations.filter((v) => v.status === "passed").length,
      failed: allValidations.filter((v) => v.status === "failed").length,
      skipped: allResults.filter((r) => r.status === "skipped").length,
    };
    const startedAt = allResults[0]?.startedAt ?? new Date().toISOString();
    const finishedAt =
      allResults[allResults.length - 1]?.finishedAt ?? new Date().toISOString();

    const summary: RunSummaryT = {
      runId,
      mode: "testcase",
      app: source.app ?? `rerun:${source.runId}`,
      suiteTag: flagString(args, "suite-tag") ?? `rerun:${source.suiteTag ?? source.runId}`,
      testLevel: source.testLevel ?? "system",
      startedAt,
      finishedAt,
      totals,
      scenarios: allScenarios.map((s, i) => ({
        scenario: s,
        result: allResults[i],
        validation: allValidations[i],
      })),
      environment: { node: process.version, platform: process.platform, source: source.runId },
    };

    const assembled = assembleSuites(allScenarios);
    const suiteGrouping = {
      names: Object.fromEntries(assembled.map((s) => [s.tempId, s.name])),
      members: Object.fromEntries(
        assembled.map((s) => [s.tempId, s.scenarios.map((sc) => sc.id)]),
      ),
    };

    let testPlanPath: string | undefined;
    if (!args.flags["no-test-plan"]) {
      testPlanPath = await generateAndWriteTestPlan({
        summary,
        cfg,
        reportsDir: cfg.reportsDir,
      }).catch(() => undefined);
      if (testPlanPath) summary.testPlanPath = testPlanPath;
    }
    const jsonPath = await writeJsonReport(summary, {
      reportsDir: cfg.reportsDir,
      maskKeys: cfg.report.maskKeys,
    });
    const htmlPath = await writeHtmlReport(summary, {
      reportsDir: cfg.reportsDir,
      maskKeys: cfg.report.maskKeys,
    });
    const junitPath = !args.flags["no-junit"]
      ? await writeJunitReport(summary, {
          reportsDir: cfg.reportsDir,
          suites: suiteGrouping,
        })
      : undefined;

    process.stdout.write(
      `\n✓ Re-run ${runId} from ${source.runId} — total=${totals.total} passed=${totals.passed} failed=${totals.failed}\n` +
        `JSON report:  ${jsonPath}\n` +
        `HTML report:  ${htmlPath}\n` +
        (junitPath ? `JUnit XML:    ${junitPath}\n` : "") +
        (testPlanPath ? `Test Plan:    ${testPlanPath}\n` : ""),
    );
    return totals.failed > 0 ? 1 : 0;
  },
};

function resolveRunPath(from: string, reportsDir: string): string {
  // Accept full file path OR bare run id.
  if (from.endsWith(".json")) return from;
  return path.join(reportsDir, "json", `${from}.json`);
}

function bareId(id: string): string {
  // Strip the "R-…::" prefix that suite-persisted scenarios use.
  const idx = id.indexOf("::");
  return idx >= 0 ? id.slice(idx + 2) : id;
}

function hashUrl(url: string): string {
  // Tiny stable bucket; not crypto.
  let h = 0;
  for (let i = 0; i < url.length; i++) h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}
