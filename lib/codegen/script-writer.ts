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

    let generated;
    try {
      generated = generatePlaywrightScript(scenarios, codegenOpts);
    } catch (err) {
      errors.push({ pageUrl: caseFile.pageUrl, reason: `codegen: ${(err as Error).message.slice(0, 200)}` });
      continue;
    }

    const baseName = path.basename(caseFilePath, path.extname(caseFilePath));

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
 * Playwright configuration for auto-generated POM-based tests.
 * Generated by ai-automation-framework — safe to modify.
 *
 * Run:   npx playwright test --config playwright.config.ts
 * UI:    npx playwright test --ui
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
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
