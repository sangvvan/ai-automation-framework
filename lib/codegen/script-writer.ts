/**
 * Script Writer — POM-based, hash-merge spec files
 *
 * Output structure:
 *   tests/generated/scripts/<project>/<role>/
 *     playwright.config.ts        ← Playwright config (written once)
 *     <page-slug>.spec.ts         ← two-zone spec (AUTO merged, CUSTOM preserved)
 *     pom/
 *       <page-slug>.page.ts       ← POM class (protected from overwrite by default)
 *
 * On every re-run:
 *   • Spec AUTO zone  → individual test() blocks updated only when their hash changes
 *   • Spec CUSTOM zone → never touched (testers own this zone)
 *   • POM file        → written once; use --overwrite-pom to refresh locators
 */

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { parseTestCaseFile } from "../scenario/parse";
import { generatePlaywrightScript, type PlaywrightCodegenOptions } from "./playwright-codegen";
import { mergeAndWriteSpec } from "./spec-merger";
import type { ExecutableScenario } from "../validation";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GenerateScriptsOptions {
  /** Path to the manifest.json produced by generateTestCasesFromSiteMap */
  manifestPath: string;
  /** Root output directory for spec + pom/ files */
  outputDir?: string;
  /** ISTQB annotations in test blocks (default true) */
  istqbAnnotations?: boolean;
  /** Per-scenario Playwright timeout in ms (default 30000) */
  scenarioTimeoutMs?: number;
  /**
   * Overwrite existing POM files (default false).
   * Keep false to preserve hand-added helper methods in the POM class.
   */
  overwritePom?: boolean;
}

export interface GenerateScriptsManifest {
  project: string;
  role: string;
  generatedAt: string;
  casesManifestPath: string;
  scriptsDir: string;
  files: GeneratedScriptFile[];
  errors: { pageUrl: string; reason: string }[];
  totals: {
    pages: number;
    scenariosTotal: number;
    scenariosSkipped: number;
    filesWritten: number;
    specBlocksAdded: number;
    specBlocksUpdated: number;
    specBlocksKept: number;
    specBlocksRemoved: number;
    pomFilesWritten: number;
    pomFilesPreserved: number;
  };
}

export interface GeneratedScriptFile {
  pageUrl: string;
  specPath: string;
  pomPath: string;
  scenarioCount: number;
  skippedCount: number;
  specStats: { added: number; updated: number; kept: number; removed: number };
  pomOverwritten: boolean;
}

interface CasesManifest {
  project: string;
  role: string;
  files: {
    pageUrl: string;
    filePath: string;
    /**
     * Full ExecutableScenario JSON sidecar written by generate.ts.
     * Present for AI-generated cases; absent for human-authored files.
     * Preferred over YAML because it preserves structured action data.
     */
    scenariosPath?: string;
    scenarioCount: number;
  }[];
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function generateAutomationScripts(
  opts: GenerateScriptsOptions,
): Promise<GenerateScriptsManifest> {
  const manifestRaw = await readFile(opts.manifestPath, "utf8");
  const casesManifest: CasesManifest = JSON.parse(manifestRaw);

  const manifestDir = path.dirname(opts.manifestPath);
  const scriptsDir =
    opts.outputDir ??
    path.join("tests", "generated", "scripts", slug(casesManifest.project), slug(casesManifest.role));
  const pomDir = path.join(scriptsDir, "pom");

  await mkdir(scriptsDir, { recursive: true });
  await mkdir(pomDir, { recursive: true });

  const files: GeneratedScriptFile[] = [];
  const errors: { pageUrl: string; reason: string }[] = [];

  let totalScenarios = 0;
  let totalSkipped = 0;
  let totalAdded = 0, totalUpdated = 0, totalKept = 0, totalRemoved = 0;
  let pomWritten = 0, pomPreserved = 0;

  const codegenOpts: PlaywrightCodegenOptions = {
    istqbAnnotations: opts.istqbAnnotations ?? true,
    scenarioTimeoutMs: opts.scenarioTimeoutMs ?? 30_000,
    // pomSlugName injected per file below so import path matches the actual .page.ts filename
  };

  for (const caseFile of casesManifest.files) {
    const caseFilePath = path.isAbsolute(caseFile.filePath)
      ? caseFile.filePath
      : path.resolve(manifestDir, caseFile.filePath);

    let scenarios: ExecutableScenario[];
    try {
      if (caseFile.scenariosPath) {
        // Prefer full structured JSON sidecar — preserves click/fill/select etc.
        const scenariosJsonPath = path.isAbsolute(caseFile.scenariosPath)
          ? caseFile.scenariosPath
          : path.resolve(manifestDir, caseFile.scenariosPath);
        const raw = await readFile(scenariosJsonPath, "utf8");
        scenarios = JSON.parse(raw) as ExecutableScenario[];
      } else {
        // Fallback for human-authored YAML test cases (text steps only —
        // spec will contain TODO placeholders for non-navigation actions).
        scenarios = await parseTestCaseFile(caseFilePath);
      }
    } catch (err) {
      errors.push({ pageUrl: caseFile.pageUrl, reason: `parse: ${(err as Error).message.slice(0, 200)}` });
      continue;
    }
    if (!scenarios.length) {
      errors.push({ pageUrl: caseFile.pageUrl, reason: "no scenarios" });
      continue;
    }

    const baseName = path.basename(caseFilePath, path.extname(caseFilePath));

    let generated;
    try {
      generated = generatePlaywrightScript(scenarios, { ...codegenOpts, pomSlugName: baseName });
    } catch (err) {
      errors.push({ pageUrl: caseFile.pageUrl, reason: `codegen: ${(err as Error).message.slice(0, 200)}` });
      continue;
    }

    // ── Spec file — smart merge (AUTO zone updated, CUSTOM zone preserved) ──
    const specPath = path.join(scriptsDir, `${baseName}.spec.ts`);
    const mergeResult = await mergeAndWriteSpec(specPath, generated.specParts);

    // ── POM file — written once, protected from overwrite by default ─────────
    const pomPath = path.join(pomDir, `${baseName}.page.ts`);
    const pomExists = await fileExists(pomPath);
    let pomOverwritten = false;

    if (!pomExists || opts.overwritePom) {
      await writeFile(pomPath, generated.pomCode, "utf8");
      pomWritten++;
      pomOverwritten = pomExists;
    } else {
      pomPreserved++;
    }

    totalScenarios += scenarios.length;
    totalSkipped   += generated.skippedScenarios.length;
    totalAdded     += mergeResult.stats.added;
    totalUpdated   += mergeResult.stats.updated;
    totalKept      += mergeResult.stats.kept;
    totalRemoved   += mergeResult.stats.removed;

    files.push({
      pageUrl: caseFile.pageUrl,
      specPath,
      pomPath,
      scenarioCount: scenarios.length - generated.skippedScenarios.length,
      skippedCount: generated.skippedScenarios.length,
      specStats: mergeResult.stats,
      pomOverwritten,
    });
  }

  await ensurePlaywrightConfig(scriptsDir);

  const manifest: GenerateScriptsManifest = {
    project: casesManifest.project,
    role: casesManifest.role,
    generatedAt: new Date().toISOString(),
    casesManifestPath: opts.manifestPath,
    scriptsDir,
    files,
    errors,
    totals: {
      pages: casesManifest.files.length,
      scenariosTotal: totalScenarios,
      scenariosSkipped: totalSkipped,
      filesWritten: files.length,
      specBlocksAdded: totalAdded,
      specBlocksUpdated: totalUpdated,
      specBlocksKept: totalKept,
      specBlocksRemoved: totalRemoved,
      pomFilesWritten: pomWritten,
      pomFilesPreserved: pomPreserved,
    },
  };

  await writeFile(
    path.join(scriptsDir, "scripts-manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  return manifest;
}

// ---------------------------------------------------------------------------
// Playwright config
// ---------------------------------------------------------------------------

async function ensurePlaywrightConfig(scriptsDir: string): Promise<void> {
  const p = path.join(scriptsDir, "playwright.config.ts");
  if (await fileExists(p)) return;

  await writeFile(p, `import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for AI-generated POM tests.
 * Generated by ai-automation-framework — safe to customise.
 *
 * Quick start:
 *   npx playwright test --config playwright.config.ts
 *   npx playwright test --ui                           # interactive UI mode
 *   npx playwright test --headed                       # show browser window
 *   BASE_URL=https://staging.example.com npx playwright test
 *
 * Re-run only failures:
 *   npx playwright test --last-failed
 *
 * View HTML report:
 *   npx playwright show-report playwright-report
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',

  /** Per-test timeout. Override per test with test.setTimeout(). */
  timeout: 45_000,

  /** Expect assertion timeout. */
  expect: { timeout: 10_000 },

  /** Retry failed tests: once locally so flaky tests surface, twice in CI. */
  retries: process.env.CI ? 2 : 1,

  /** Run test files in parallel; tests within a file run serially by default. */
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,

  reporter: [
    /** Rich interactive HTML report — open with: npx playwright show-report */
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    /** JUnit XML for CI/CD pipelines (GitHub Actions, Jenkins, GitLab CI) */
    ['junit', { outputFile: 'test-results/junit.xml' }],
    /** Concise terminal output */
    ['list'],
  ],

  use: {
    /** Base URL — override via BASE_URL env var for different environments. */
    baseURL: process.env.BASE_URL || 'http://localhost:3000',

    headless: true,
    viewport: { width: 1280, height: 800 },

    /** Collect traces and video only on failures to keep artefacts lean. */
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',

    /** Capture Playwright action timing in traces. */
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  /** Output folder for test artefacts (traces, videos, screenshots). */
  outputDir: 'test-results',

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment to run cross-browser:
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit',  use: { ...devices['Desktop Safari'] } },
    // { name: 'mobile',  use: { ...devices['Pixel 7'] } },
  ],
});
`, "utf8");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
