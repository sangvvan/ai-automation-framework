/**
 * Workflow step: Generate Playwright automation scripts from test case manifests.
 *
 * Always emits POM-based output:
 *   tests/generated/scripts/<project>/<role>/
 *     playwright.config.ts
 *     <page>.spec.ts         ← thin spec, uses POM class
 *     pom/
 *       <page>.page.ts       ← POM class: locators + goto()
 *
 * Pipeline position:
 *   auth → crawl → generate-cases → [generate-scripts] → run-suite
 */

import path from "node:path";
import { generateAutomationScripts, type GenerateScriptsManifest } from "../codegen/script-writer";
import type { GenerateSuiteResult } from "./generate";

export interface GenerateScriptsWorkflowOptions {
  /** Result from the preceding generateTestCasesFromSiteMap call */
  generationResult: GenerateSuiteResult;
  /** Project name (used to construct the output path) */
  project: string;
  /** Role name (used to construct the output path) */
  role: string;
  /** Override output directory for .spec.ts + pom/ files */
  outputDir?: string;
  /** ISTQB technique comments above each test (default true) */
  istqbAnnotations?: boolean;
  /** Per-scenario timeout override in ms */
  scenarioTimeoutMs?: number;
  /**
   * Overwrite existing POM files (default false — preserves hand-added helper methods).
   * Set to true only when intentionally regenerating after scenario changes.
   */
  overwritePom?: boolean;
}

export interface GenerateScriptsWorkflowResult {
  scriptsDir: string;
  scriptsManifestPath: string;
  specFiles: string[];
  pomFiles: string[];
  pomFilesPreserved: number;
  skippedPages: number;
  totalScenarios: number;
  errors: { pageUrl: string; reason: string }[];
}

/**
 * Generate Playwright POM-based automation scripts for all test cases in the manifest.
 *
 * Returns paths to every .spec.ts and .page.ts written so downstream steps
 * can log them or hand them off to Playwright directly.
 */
export async function generateScriptsForSuite(
  opts: GenerateScriptsWorkflowOptions,
): Promise<GenerateScriptsWorkflowResult> {
  const { generationResult, project, role } = opts;

  const manifest: GenerateScriptsManifest = await generateAutomationScripts({
    manifestPath: generationResult.manifestPath,
    outputDir:
      opts.outputDir ??
      path.join(
        "tests",
        "generated",
        "scripts",
        slug(project),
        slug(role),
      ),
    istqbAnnotations: opts.istqbAnnotations ?? true,
    scenarioTimeoutMs: opts.scenarioTimeoutMs,
    overwritePom: opts.overwritePom ?? false,
  });

  const specFiles = manifest.files.map((f) => f.specPath);
  const pomFiles = manifest.files.map((f) => f.pomPath);
  const scriptsManifestPath = path.join(manifest.scriptsDir, "scripts-manifest.json");

  return {
    scriptsDir: manifest.scriptsDir,
    scriptsManifestPath,
    specFiles,
    pomFiles,
    pomFilesPreserved: manifest.totals.pomFilesPreserved,
    skippedPages: manifest.errors.length,
    totalScenarios: manifest.totals.scenariosTotal,
    errors: manifest.errors,
  };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
