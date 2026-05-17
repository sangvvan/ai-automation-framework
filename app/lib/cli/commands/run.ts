import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config";
import { flagString } from "../args";
import { generateRunId } from "../run-id";
import { analyzePage } from "../../analyzer/analyze";
import { parseTestCaseFile } from "../../scenario/parse";
import { mapStepsToActions } from "../../scenario/step-mapper";
import { runScenarios } from "../../runner/runner";
import { validateScenarioResult } from "../../validator/validate";
import { writeJsonReport } from "../../reporter/json";
import { writeHtmlReport } from "../../reporter/html";
import { buildProvider } from "../../ai/factory";
import { designScenarios } from "../../ai/agents/test-design";
import { persistRun } from "../../db/runs";
import type { RunSummary } from "../../validation";
import type { CliCommand } from "../commands";
import type { ExecutableScenario } from "../../validation";

export const runCommand: CliCommand = {
  help: {
    name: "run",
    summary: "Execute a test run against a URL.",
    example:
      'ai-test run --url https://example.com --test-case inputs/test-cases/login.yaml --mode testcase',
    options: [
      { flag: "--url", description: "Target page URL (required)" },
      { flag: "--test-case", description: "Path to YAML or MD test case file" },
      { flag: "--mode", description: "testcase | explore", default: "testcase" },
      { flag: "--output-dir", description: "Override reports root" },
      { flag: "--suite-tag", description: "Tag for regression-diff grouping" },
    ],
  },
  run: async (args) => {
    const url = flagString(args, "url");
    if (!url) {
      process.stderr.write("Missing --url\n");
      return 1;
    }
    const mode = (flagString(args, "mode") ?? "testcase") as "testcase" | "explore";
    if (mode !== "testcase" && mode !== "explore") {
      process.stderr.write(`Invalid --mode: ${mode}\n`);
      return 1;
    }

    const cfg = loadConfig();
    const runId = generateRunId();
    const evidenceDir = path.join(cfg.evidenceDir, runId);
    await mkdir(evidenceDir, { recursive: true });

    // 1. Analyze the page (grounding for both modes)
    const analysis = await analyzePage({
      url,
      viewport: cfg.runner.viewport,
      screenshotPath: path.join(evidenceDir, "page.png"),
      headless: cfg.runner.headless,
      navigationTimeoutMs: cfg.runner.navigationTimeoutMs,
    });

    // 2. Build scenarios
    let scenarios: ExecutableScenario[] = [];
    if (mode === "testcase") {
      const tcFile = flagString(args, "test-case");
      if (!tcFile) {
        process.stderr.write("--test-case is required for --mode testcase\n");
        return 1;
      }
      const parsed = await parseTestCaseFile(tcFile);
      scenarios = parsed.map((s) => ({
        ...s,
        steps: mapStepsToActions(s.steps, analysis, s.pageUrl).steps,
        warnings: mapStepsToActions(s.steps, analysis, s.pageUrl).warnings,
      }));
    } else {
      const provider = buildProvider({
        config: cfg,
        role: "design",
        tracePath: path.join(evidenceDir, "ai-trace.jsonl"),
      });
      try {
        scenarios = await designScenarios({
          analysis,
          provider,
          maxScenarios: cfg.generation.maxScenarios,
          categories: cfg.generation.categories,
        });
      } catch (err) {
        // No provider configured/usable — fall back to a single
        // "open page" scenario so the skeleton still produces output.
        process.stderr.write(
          `Warning: AI generation unavailable (${(err as Error).message}); emitting smoke-only scenario.\n`,
        );
        scenarios = [
          {
            id: `EXPLORE_${runId}_001`,
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
            expectedResult: { text: analysis.title },
            warnings: [],
          },
        ];
      }
    }

    // 3. Run
    const results = await runScenarios(scenarios, {
      headless: cfg.runner.headless,
      stepTimeoutMs: cfg.runner.stepTimeoutMs,
      navigationTimeoutMs: cfg.runner.navigationTimeoutMs,
      viewport: cfg.runner.viewport,
      evidenceDir,
      captureScreenshotOnSuccess: cfg.runner.captureScreenshotOnSuccess,
    });

    // 4. Validate
    const validations = results.map((r, i) =>
      validateScenarioResult(r, scenarios[i].expectedResult),
    );

    const startedAt = results.length ? results[0].startedAt : new Date().toISOString();
    const finishedAt = results.length
      ? results[results.length - 1].finishedAt
      : new Date().toISOString();

    const totals = {
      total: scenarios.length,
      passed: validations.filter((v) => v.status === "passed").length,
      failed: validations.filter((v) => v.status === "failed").length,
      skipped: results.filter((r) => r.status === "skipped").length,
    };

    const summary: RunSummary = {
      runId,
      mode,
      app: url,
      suiteTag: flagString(args, "suite-tag"),
      startedAt,
      finishedAt,
      totals,
      scenarios: scenarios.map((s, i) => ({
        scenario: s,
        result: results[i],
        validation: validations[i],
      })),
      environment: { node: process.version, platform: process.platform },
    };

    // 5. Reports
    const jsonPath = await writeJsonReport(summary, {
      maskKeys: cfg.report.maskKeys,
      reportsDir: cfg.reportsDir,
    });
    const htmlPath = await writeHtmlReport(summary, {
      maskKeys: cfg.report.maskKeys,
      reportsDir: cfg.reportsDir,
    });

    process.stdout.write(
      `\n✓ Run ${runId} finished — total=${totals.total} passed=${totals.passed} failed=${totals.failed} skipped=${totals.skipped}\n`,
    );
    process.stdout.write(`JSON report: ${jsonPath}\n`);
    process.stdout.write(`HTML report: ${htmlPath}\n`);

    // Also write run-summary file to evidence for traceability
    await writeFile(
      path.join(evidenceDir, "run-summary.json"),
      JSON.stringify({ runId, jsonPath, htmlPath, totals }, null, 2),
    );

    // Persist to DB if available (no-op otherwise). Lets the Review UI
    // show generated scenarios as pending_review.
    await persistRun(summary, { jsonPath, htmlPath }).catch((err) => {
      process.stderr.write(
        `Note: DB persistence skipped (${(err as Error).message}).\n`,
      );
    });

    return totals.failed > 0 ? 1 : 0;
  },
};
