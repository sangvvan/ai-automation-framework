import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzePage } from "../analyzer/analyze";
import type { FrameworkConfig } from "../config";
import { persistRun } from "../db/runs";
import { generateRunId } from "../cli/run-id";
import { parseTestCaseFile } from "../scenario/parse";
import { mapStepsToActions } from "../scenario/step-mapper";
import { writeHtmlReport } from "../reporter/html";
import { writeJsonReport } from "../reporter/json";
import { runScenarios } from "../runner/runner";
import { validateScenarioResult } from "../validator/validate";
import {
  ExecutableScenario,
  type RunSummary,
  type ScenarioResult,
  type ValidationResult,
} from "../validation";
import { SiteMap } from "../validation/sitemap";

export interface RunSuiteOptions {
  cfg: FrameworkConfig;
  casesDir: string;
  siteMapPath?: string;
  storageStatePath?: string;
  project?: string;
  role?: string;
  suiteTag?: string;
  captureScreenshotOnSuccess?: boolean;
}

export interface RunSuiteResult {
  runId: string;
  jsonPath: string;
  htmlPath: string;
  totals: RunSummary["totals"];
  filesRun: string[];
  filesSkipped: { filePath: string; reason: string }[];
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

  const allScenarios: ExecutableScenario[] = [];
  const allResults: ScenarioResult[] = [];
  const allValidations: ValidationResult[] = [];
  const filesRun: string[] = [];
  const filesSkipped: { filePath: string; reason: string }[] = [];

  for (const file of files) {
    const parsed = await parseTestCaseFile(file);
    if (!parsed.length) {
      filesSkipped.push({ filePath: file, reason: "no scenarios" });
      continue;
    }

    const pageUrl = parsed[0].pageUrl;
    if (allowedUrls && !allowedUrls.has(pageUrl)) {
      filesSkipped.push({ filePath: file, reason: "page_url not present in sitemap" });
      continue;
    }

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

    const scenarios = parsed.map((scenario) => {
      const mapped = mapStepsToActions(scenario.steps, analysis, scenario.pageUrl);
      return ExecutableScenario.parse({
        ...scenario,
        steps: mapped.steps,
        warnings: [...scenario.warnings, ...mapped.warnings],
      });
    });

    const results = await runScenarios(scenarios, {
      headless: opts.cfg.runner.headless,
      stepTimeoutMs: opts.cfg.runner.stepTimeoutMs,
      navigationTimeoutMs: opts.cfg.runner.navigationTimeoutMs,
      viewport: opts.cfg.runner.viewport,
      evidenceDir: pageDir,
      captureScreenshotOnSuccess:
        opts.captureScreenshotOnSuccess ?? opts.cfg.runner.captureScreenshotOnSuccess,
      storageStatePath,
    });
    const validations = results.map((result, i) =>
      validateScenarioResult(result, scenarios[i].expectedResult),
    );

    allScenarios.push(...scenarios);
    allResults.push(...results);
    allValidations.push(...validations);
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
    startedAt,
    finishedAt,
    totals,
    scenarios: allScenarios.map((scenario, i) => ({
      scenario,
      result: allResults[i],
      validation: allValidations[i],
    })),
    environment: { node: process.version, platform: process.platform },
  };

  const jsonPath = await writeJsonReport(summary, {
    maskKeys: opts.cfg.report.maskKeys,
    reportsDir: opts.cfg.reportsDir,
  });
  const htmlPath = await writeHtmlReport(summary, {
    maskKeys: opts.cfg.report.maskKeys,
    reportsDir: opts.cfg.reportsDir,
  });
  await writeFile(
    path.join(evidenceDir, "run-summary.json"),
    JSON.stringify({ runId, jsonPath, htmlPath, totals, filesRun, filesSkipped }, null, 2),
  );

  let persistenceWarning: string | undefined;
  await persistRun(summary, { jsonPath, htmlPath }).catch((err) => {
    persistenceWarning = (err as Error).message;
  });

  return {
    runId,
    jsonPath,
    htmlPath,
    totals,
    filesRun,
    filesSkipped,
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
