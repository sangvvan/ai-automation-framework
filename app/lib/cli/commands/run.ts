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
import { writeJunitReport } from "../../reporter/junit";
import { generateAndWriteTestPlan } from "../../reporter/test-plan-generator";
import { assembleSuites } from "../../review/suite-assembler";
import { buildProvider } from "../../ai/factory";
import { designScenarios } from "../../ai/agents/test-design";
import { persistRun } from "../../db/runs";
import type {
  RunSummary,
  ScenarioResult,
  ValidationResult,
} from "../../validation";
import type { CliCommand } from "../commands";
import type { ExecutableScenario } from "../../validation";
import { orchestrateSiteMap } from "../orchestrate-sitemap";

export const runCommand: CliCommand = {
  help: {
    name: "run",
    summary: "Execute a test run against a URL or a SiteMap.",
    example:
      "ai-test run --url https://example.com --test-case inputs/test-cases/login.yaml --mode testcase\n" +
      "  ai-test run --site-map reports/sitemaps/C-…json --mode explore",
    options: [
      { flag: "--url", description: "Target page URL (single-page mode)" },
      { flag: "--site-map", description: "Path to a SiteMap JSON (multi-page mode)" },
      { flag: "--test-case", description: "Path to YAML or MD test case file" },
      { flag: "--mode", description: "testcase | explore", default: "testcase" },
      { flag: "--output-dir", description: "Override reports root" },
      { flag: "--suite-tag", description: "Tag for regression-diff grouping" },
      { flag: "--storage-state", description: "Override storage-state.json path" },
      {
        flag: "--test-level",
        description: "unit | component | integration | system | acceptance",
        default: "system",
      },
      {
        flag: "--techniques",
        description: "Comma-separated ISTQB design techniques to drive AI generation",
      },
    ],
  },
  run: async (args) => {
    const url = flagString(args, "url");
    const siteMapPath = flagString(args, "site-map");
    if (!url && !siteMapPath) {
      process.stderr.write("Provide --url or --site-map\n");
      return 1;
    }
    if (url && siteMapPath) {
      process.stderr.write("--url and --site-map are mutually exclusive\n");
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

    let scenarios: ExecutableScenario[] = [];
    let results: ScenarioResult[] = [];
    let validations: ValidationResult[] = [];
    let appLabel: string | undefined;

    if (siteMapPath) {
      if (mode === "testcase") {
        process.stderr.write(
          "--site-map currently supports --mode explore only (no per-page test-case mapping yet)\n",
        );
        return 1;
      }
      const bundles = await orchestrateSiteMap({
        siteMapPath,
        cfg,
        runId,
        evidenceRoot: evidenceDir,
        explore: true,
        storageStatePath: flagString(args, "storage-state"),
      });
      for (const b of bundles) {
        scenarios.push(...b.scenarios);
        results.push(...b.results);
        validations.push(...b.validations);
      }
      appLabel = `sitemap:${path.basename(siteMapPath)}`;
    } else {
      const analysis = await analyzePage({
        url: url!,
        viewport: cfg.runner.viewport,
        screenshotPath: path.join(evidenceDir, "page.png"),
        headless: cfg.runner.headless,
        navigationTimeoutMs: cfg.runner.navigationTimeoutMs,
      });

      if (mode === "testcase") {
        const tcFile = flagString(args, "test-case");
        if (!tcFile) {
          process.stderr.write("--test-case is required for --mode testcase\n");
          return 1;
        }
        const parsed = await parseTestCaseFile(tcFile);
        scenarios = parsed.map((s) => {
          const mapped = mapStepsToActions(s.steps, analysis, s.pageUrl);
          return { ...s, steps: mapped.steps, warnings: mapped.warnings };
        });
      } else {
        const provider = buildProvider({
          config: cfg,
          role: "design",
          tracePath: path.join(evidenceDir, "ai-trace.jsonl"),
        });
        const techniquesArg = flagString(args, "techniques");
        const requestedTechniques = techniquesArg
          ? (techniquesArg.split(",").map((s) => s.trim()).filter(Boolean) as
              import("../../validation").DesignTechnique[])
          : undefined;
        try {
          scenarios = await designScenarios({
            analysis,
            provider,
            maxScenarios: cfg.generation.maxScenarios,
            categories: cfg.generation.categories,
            requestedTechniques,
          });
        } catch (err) {
          process.stderr.write(
            `Warning: AI generation unavailable (${(err as Error).message}); emitting smoke-only scenario.\n`,
          );
          scenarios = [
            {
              id: `EXPLORE_${runId}_001`,
              title: `Open ${url} and verify it loads`,
              type: "navigation",
              priority: "P2",
              pageUrl: url!,
              origin: "ai-generated",
              steps: [
                {
                  index: 0,
                  description: `Open ${url}`,
                  action: { keyword: "open_page", url: url! },
                  resolved: true,
                },
              ],
              expectedResult: { text: analysis.title },
              warnings: [],
            },
          ];
        }
      }

      results = await runScenarios(scenarios, {
        headless: cfg.runner.headless,
        stepTimeoutMs: cfg.runner.stepTimeoutMs,
        navigationTimeoutMs: cfg.runner.navigationTimeoutMs,
        viewport: cfg.runner.viewport,
        evidenceDir,
        captureScreenshotOnSuccess: cfg.runner.captureScreenshotOnSuccess,
      });
      validations = results.map((r, i) =>
        validateScenarioResult(r, scenarios[i].expectedResult),
      );
      appLabel = url;
    }

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

    // Assemble suites (one per page; ad-hoc fallback). Used for JUnit
    // grouping and persisted by the DB layer later if available.
    const assembled = assembleSuites(scenarios);
    const suiteOf = new Map<string, string>(); // scenarioId → suite display name
    const suiteGrouping: { names: Record<string, string>; members: Record<string, string[]> } = {
      names: {},
      members: {},
    };
    for (const s of assembled) {
      suiteGrouping.names[s.tempId] = s.name;
      suiteGrouping.members[s.tempId] = s.scenarios.map((sc) => sc.id);
      for (const sc of s.scenarios) suiteOf.set(sc.id, s.name);
    }

    // Roll-up by ISTQB design technique (REQ-012 §coverage panel).
    const techniqueRoll = new Map<string, { total: number; passed: number }>();
    for (let i = 0; i < scenarios.length; i++) {
      const technique = scenarios[i].designTechnique ?? "error-guessing";
      const r = techniqueRoll.get(technique) ?? { total: 0, passed: 0 };
      r.total++;
      if (validations[i].status === "passed") r.passed++;
      techniqueRoll.set(technique, r);
    }
    const techniqueCoverage = [...techniqueRoll.entries()].map(([technique, v]) => ({
      technique,
      total: v.total,
      passed: v.passed,
    }));

    const testLevel = (flagString(args, "test-level") ?? "system") as
      | "unit" | "component" | "integration" | "system" | "acceptance";

    const summary: RunSummary = {
      runId,
      mode,
      app: appLabel,
      suiteTag: flagString(args, "suite-tag"),
      testLevel,
      startedAt,
      finishedAt,
      totals,
      scenarios: scenarios.map((s, i) => ({
        scenario: s,
        result: results[i],
        validation: validations[i],
      })),
      environment: { node: process.version, platform: process.platform },
      techniqueCoverage,
    };
    void suiteOf;

    // Test Plan (ISTQB) — deterministic, persisted alongside reports.
    let testPlanPath: string | undefined;
    try {
      testPlanPath = await generateAndWriteTestPlan({
        summary,
        cfg,
        reportsDir: cfg.reportsDir,
      });
      summary.testPlanPath = testPlanPath;
    } catch (err) {
      process.stderr.write(`Note: TestPlan generation failed (${(err as Error).message}).\n`);
    }

    const jsonPath = await writeJsonReport(summary, {
      maskKeys: cfg.report.maskKeys,
      reportsDir: cfg.reportsDir,
    });
    const htmlPath = await writeHtmlReport(summary, {
      maskKeys: cfg.report.maskKeys,
      reportsDir: cfg.reportsDir,
    });
    const junitPath = await writeJunitReport(summary, {
      reportsDir: cfg.reportsDir,
      suites: suiteGrouping,
    });

    process.stdout.write(
      `\n✓ Run ${runId} finished — total=${totals.total} passed=${totals.passed} failed=${totals.failed} skipped=${totals.skipped}\n`,
    );
    process.stdout.write(`JSON report:  ${jsonPath}\n`);
    process.stdout.write(`HTML report:  ${htmlPath}\n`);
    process.stdout.write(`JUnit XML:    ${junitPath}\n`);
    if (testPlanPath) process.stdout.write(`Test Plan:    ${testPlanPath}\n`);

    await writeFile(
      path.join(evidenceDir, "run-summary.json"),
      JSON.stringify({ runId, jsonPath, htmlPath, totals }, null, 2),
    );

    await persistRun(summary, { jsonPath, htmlPath }).catch((err) => {
      process.stderr.write(
        `Note: DB persistence skipped (${(err as Error).message}).\n`,
      );
    });

    return totals.failed > 0 ? 1 : 0;
  },
};
