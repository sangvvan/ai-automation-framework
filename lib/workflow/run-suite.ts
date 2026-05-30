import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzePage } from "../analyzer/analyze";
import type { FrameworkConfig } from "../config";
import { persistRun } from "../db/runs";
import { defectsRepo } from "../db/defects";
import { generateRunId } from "../cli/run-id";
import { parseTestCaseFile } from "../scenario/parse";
import { mapStepsToActions } from "../scenario/step-mapper";
import { writeHtmlReport } from "../reporter/html";
import { writeJsonReport } from "../reporter/json";
import { writeJunitReport } from "../reporter/junit";
import { generateAndWriteTestPlan } from "../reporter/test-plan-generator";
import { assembleSuites } from "../review/suite-assembler";
import {
  postPrComment,
  readGithubPrEnvFromProcess,
} from "../reporter/github-pr";
import { runScenarios } from "../runner/runner";
import { validateScenarioResult } from "../validator/validate";
import {
  ExecutableScenario,
  type RunSummary,
  type ScenarioResult,
  type TestLevel,
  type ValidationResult,
} from "../validation";
import { SiteMap } from "../validation/sitemap";
import type { BrowserName } from "../browser/launcher";

export interface RunSuiteOptions {
  cfg: FrameworkConfig;
  casesDir: string;
  siteMapPath?: string;
  storageStatePath?: string;
  project?: string;
  role?: string;
  suiteTag?: string;
  captureScreenshotOnSuccess?: boolean;
  /** ISTQB test level surfaced in reports + TestPlan (REQ-011). */
  testLevel?: TestLevel;
  /** Browser matrix (REQ-013). Defaults to chromium only. */
  browsers?: BrowserName[];
  /** Locale matrix (REQ-013). Undefined entry = no locale override. */
  locales?: (string | undefined)[];
  /** Non-functional post-checks (REQ-013). */
  nonFunctional?: {
    a11y?: boolean;
    vitals?: boolean;
    securityHeaders?: boolean;
    a11yFailOn?: ("minor" | "moderate" | "serious" | "critical")[];
  };
  /** Emit JUnit XML (default true). */
  junit?: boolean;
  /** Emit TestPlan JSON (default true). */
  testPlan?: boolean;
  /** Insert one defects row per failed scenario when DB available. */
  persistDefects?: boolean;
  /** Post a GitHub PR comment when env present. */
  prComment?: boolean;
}

export interface RunSuiteResult {
  runId: string;
  jsonPath: string;
  htmlPath: string;
  junitPath?: string;
  testPlanPath?: string;
  totals: RunSummary["totals"];
  filesRun: string[];
  filesSkipped: { filePath: string; reason: string }[];
  defectsInserted: number;
  prCommentUrl?: string | null;
  persistenceWarning?: string;
}

export async function runTestCaseSuite(
  opts: RunSuiteOptions,
): Promise<RunSuiteResult> {
  const files = await collectTestCaseFiles(opts.casesDir);
  const siteMapInfo = opts.siteMapPath ? await readSiteMapInfo(opts.siteMapPath) : undefined;
  const allowedUrls = siteMapInfo?.urls;
  const storageStatePath = opts.storageStatePath ?? siteMapInfo?.storageStatePath;
  const runId = generateRunId();
  const evidenceDir = path.join(opts.cfg.evidenceDir, runId);
  await mkdir(evidenceDir, { recursive: true });

  const browsers: BrowserName[] = opts.browsers && opts.browsers.length
    ? opts.browsers
    : ["chromium"];
  const locales: (string | undefined)[] =
    opts.locales && opts.locales.length ? opts.locales : [undefined];

  const allScenarios: ExecutableScenario[] = [];
  const allResults: ScenarioResult[] = [];
  const allValidations: ValidationResult[] = [];
  const filesRun: string[] = [];
  const filesSkipped: { filePath: string; reason: string }[] = [];

  for (const file of files) {
    let parsed: ExecutableScenario[];
    let preResolved = false;
    try {
      // Prefer pre-resolved scenarios.json sidecar (CSS/XPath locators from AI analysis)
      const scenariosJson = file.replace(/\.(yaml|yml|md)$/i, ".scenarios.json");
      if (await readFile(scenariosJson, "utf8").then(() => true).catch(() => false)) {
        const raw = JSON.parse(await readFile(scenariosJson, "utf8"));
        parsed = Array.isArray(raw)
          ? raw.map((s) => ExecutableScenario.parse(s))
          : [];
        preResolved = true;
      } else {
        parsed = await parseTestCaseFile(file);
      }
    } catch (err) {
      filesSkipped.push({
        filePath: file,
        reason: `parse error: ${(err as Error).message.slice(0, 160)}`,
      });
      continue;
    }
    if (!parsed.length) {
      filesSkipped.push({ filePath: file, reason: "no scenarios" });
      continue;
    }

    const pageUrl = parsed[0].pageUrl;
    if (allowedUrls && !allowedUrls.has(pageUrl)) {
      filesSkipped.push({ filePath: file, reason: "page_url not present in sitemap" });
      continue;
    }

    process.stdout.write(`  [Playwright] Launching browser and running test cases for: ${pageUrl}...\n`);

    const pageDir = path.join(evidenceDir, pageHash(pageUrl));
    await mkdir(pageDir, { recursive: true });
    const analysis = await analyzePage({
      url: pageUrl,
      viewport: opts.cfg.runner.viewport,
      screenshotPath: path.join(pageDir, "page.png"),
      headless: opts.cfg.runner.headless,
      navigationTimeoutMs: opts.cfg.runner.navigationTimeoutMs,
      storageStatePath,
    });

    const baseScenarios = preResolved
      ? parsed  // already resolved — skip mapStepsToActions text matching
      : parsed.map((scenario) => {
          const mapped = mapStepsToActions(scenario.steps, analysis, scenario.pageUrl);
          return ExecutableScenario.parse({
            ...scenario,
            steps: mapped.steps,
            warnings: [...scenario.warnings, ...mapped.warnings],
          });
        });

    // Browser × locale matrix (REQ-013).
    for (const browser of browsers) {
      for (const locale of locales) {
        const tag =
          (browsers.length > 1 ? `-${browser}` : "") +
          (locale && locales.length > 1 ? `-${locale}` : "");
        const matrixScenarios: ExecutableScenario[] = tag
          ? baseScenarios.map((s) => ({ ...s, id: `${s.id}${tag}` }))
          : baseScenarios;
        const outcome = await runScenarios(matrixScenarios, {
          headless: opts.cfg.runner.headless,
          stepTimeoutMs: opts.cfg.runner.stepTimeoutMs,
          navigationTimeoutMs: opts.cfg.runner.navigationTimeoutMs,
          viewport: opts.cfg.runner.viewport,
          evidenceDir: pageDir,
          captureScreenshotOnSuccess:
            opts.captureScreenshotOnSuccess ?? opts.cfg.runner.captureScreenshotOnSuccess,
          storageStatePath,
          browser,
          locale,
          nonFunctional: opts.nonFunctional,
        });
        const results = outcome.results;
        const validations = results.map((result, i) =>
          validateScenarioResult(result, matrixScenarios[i].expectedResult),
        );

        allScenarios.push(...matrixScenarios);
        allResults.push(...results);
        allValidations.push(...validations);
      }
    }
    filesRun.push(file);
  }

  const startedAt = allResults.length
    ? allResults[0].startedAt
    : new Date().toISOString();
  const finishedAt = allResults.length
    ? allResults[allResults.length - 1].finishedAt
    : new Date().toISOString();
  const totals = {
    total: allScenarios.length,
    passed: allValidations.filter((v) => v.status === "passed").length,
    failed: allValidations.filter((v) => v.status === "failed").length,
    skipped: allResults.filter((r) => r.status === "skipped").length,
  };

  // Suite assembly (REQ-011) for JUnit grouping.
  const assembled = assembleSuites(allScenarios);
  const suiteGrouping = {
    names: Object.fromEntries(assembled.map((s) => [s.tempId, s.name])),
    members: Object.fromEntries(
      assembled.map((s) => [s.tempId, s.scenarios.map((sc) => sc.id)]),
    ),
  };

  // Technique coverage roll-up (REQ-012).
  const techniqueRoll = new Map<string, { total: number; passed: number }>();
  for (let i = 0; i < allScenarios.length; i++) {
    const technique = allScenarios[i].designTechnique ?? "error-guessing";
    const r = techniqueRoll.get(technique) ?? { total: 0, passed: 0 };
    r.total++;
    if (allValidations[i].status === "passed") r.passed++;
    techniqueRoll.set(technique, r);
  }
  const techniqueCoverage = [...techniqueRoll.entries()].map(([technique, v]) => ({
    technique,
    total: v.total,
    passed: v.passed,
  }));

  const app = [
    opts.project ? `project:${opts.project}` : undefined,
    opts.role ? `role:${opts.role}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  const summary: RunSummary = {
    runId,
    mode: "testcase",
    app: app || `suite:${opts.casesDir}`,
    suiteTag: opts.suiteTag,
    testLevel: opts.testLevel ?? "system",
    startedAt,
    finishedAt,
    totals,
    scenarios: allScenarios.map((scenario, i) => ({
      scenario,
      result: allResults[i],
      validation: allValidations[i],
    })),
    environment: { node: process.version, platform: process.platform },
    techniqueCoverage,
  };

  // Test Plan (REQ-011) — emit before JSON/HTML so the JSON can link it.
  // Pass the parsed SiteMap (when available) so testItems lists actual
  // pages instead of falling back to the workflow's role label.
  let testPlanPath: string | undefined;
  if (opts.testPlan !== false) {
    let siteMap: import("../validation").SiteMap | undefined;
    if (opts.siteMapPath) {
      try {
        const raw = await readFile(opts.siteMapPath, "utf8");
        siteMap = SiteMap.parse(JSON.parse(raw));
      } catch {
        /* TestPlan still emits with workflow label as fallback */
      }
    }
    try {
      testPlanPath = await generateAndWriteTestPlan({
        summary,
        siteMap,
        cfg: opts.cfg,
        reportsDir: opts.cfg.reportsDir,
      });
      summary.testPlanPath = testPlanPath;
    } catch (err) {
      process.stderr.write(`  note: TestPlan generation skipped (${(err as Error).message})\n`);
    }
  }

  const jsonPath = await writeJsonReport(summary, {
    maskKeys: opts.cfg.report.maskKeys,
    reportsDir: opts.cfg.reportsDir,
  });
  const htmlPath = await writeHtmlReport(summary, {
    maskKeys: opts.cfg.report.maskKeys,
    reportsDir: opts.cfg.reportsDir,
  });

  let junitPath: string | undefined;
  if (opts.junit !== false) {
    junitPath = await writeJunitReport(summary, {
      reportsDir: opts.cfg.reportsDir,
      suites: suiteGrouping,
    });
  }

  await writeFile(
    path.join(evidenceDir, "run-summary.json"),
    JSON.stringify(
      { runId, jsonPath, htmlPath, junitPath, testPlanPath, totals, filesRun, filesSkipped },
      null,
      2,
    ),
  );

  let persistenceWarning: string | undefined;
  await persistRun(summary, { jsonPath, htmlPath }).catch((err) => {
    persistenceWarning = (err as Error).message;
  });

  // Defect persistence (REQ-017). Best-effort: needs DB.
  let defectsInserted = 0;
  if (opts.persistDefects !== false) {
    for (let i = 0; i < allScenarios.length; i++) {
      const sd = allValidations[i].suggestedDefect;
      if (!sd || allValidations[i].status !== "failed") continue;
      try {
        await defectsRepo.insert({
          runId,
          scenarioId: `${runId}::${allScenarios[i].id}`,
          summary: sd.summary,
          stepsToReproduce: sd.stepsToReproduce,
          evidenceLinks: sd.evidenceLinks,
          severity: sd.severity,
        });
        defectsInserted++;
      } catch {
        // DB unavailable — fine.
      }
    }
  }

  // GitHub PR comment (REQ-015). No-op without env.
  let prCommentUrl: string | null | undefined;
  if (opts.prComment !== false) {
    const prEnv = readGithubPrEnvFromProcess();
    if (prEnv) {
      try {
        prCommentUrl = await postPrComment(
          summary,
          { htmlReport: htmlPath, junit: junitPath },
          prEnv,
        );
      } catch (err) {
        process.stderr.write(
          `  note: PR comment failed (${(err as Error).message})\n`,
        );
      }
    }
  }

  return {
    runId,
    jsonPath,
    htmlPath,
    junitPath,
    testPlanPath,
    totals,
    filesRun,
    filesSkipped,
    defectsInserted,
    prCommentUrl,
    persistenceWarning,
  };
}

async function collectTestCaseFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTestCaseFiles(fullPath)));
    } else if (/\.(ya?ml|md|markdown)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

async function readSiteMapInfo(
  filePath: string,
): Promise<{ urls: Set<string>; storageStatePath?: string }> {
  const raw = await readFile(filePath, "utf8");
  const siteMap = SiteMap.parse(JSON.parse(raw));
  return {
    urls: new Set(siteMap.pages.map((page) => page.normalizedUrl)),
    storageStatePath: siteMap.storageStatePath,
  };
}

function pageHash(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 10);
}
