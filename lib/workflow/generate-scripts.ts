/**
 * Workflow step: Generate Playwright automation scripts from test case manifests.
 *
 * Supports two output languages:
 *
 *   TypeScript (default):
 *     tests/generated/scripts/<project>/<role>/
 *       playwright.config.ts
 *       <page>.spec.ts         ← thin spec, uses POM class
 *       pom/<page>.page.ts     ← POM class: locators + goto()
 *
 *   Python:
 *     tests/generated/scripts/<project>/<role>/
 *       conftest.py / pytest.ini / requirements.txt
 *       pages/base_page.py
 *       pages/<slug>_page.py   ← Page Object class
 *       tests/test_<slug>.py   ← pytest test class
 *
 * Pipeline position:
 *   auth → crawl → generate-cases → [generate-scripts] → run-suite
 */

import path from "node:path";
import { generateAutomationScripts, type GenerateScriptsManifest } from "../codegen/script-writer";
import { generatePythonAutomationScripts } from "../codegen/python-script-writer";
import type { GenerateSuiteResult } from "./generate";

export interface GenerateScriptsWorkflowOptions {
  /** Result from the preceding generateTestCasesFromSiteMap call */
  generationResult: GenerateSuiteResult;
  /** Project name (used to construct the output path) */
  project: string;
  /** Role name (used to construct the output path) */
  role: string;
  /**
   * Output language for generated automation scripts.
   * "typescript" (default) → Playwright .spec.ts + POM .page.ts
   * "python"               → pytest .py + Page Object .py
   */
  language?: "typescript" | "python";
  /** Override output directory */
  outputDir?: string;
  /** ISTQB technique comments above each test (default true) */
  istqbAnnotations?: boolean;
  /** Per-scenario timeout override in ms (TypeScript only) */
  scenarioTimeoutMs?: number;
  /**
   * Overwrite existing POM / page-object files (default false).
   * Hand-added helper methods are preserved by default.
   */
  overwritePom?: boolean;
}

export interface GenerateScriptsWorkflowResult {
  language: "typescript" | "python";
  scriptsDir: string;
  scriptsManifestPath: string;
  /** TypeScript: .spec.ts paths | Python: test_*.py paths */
  specFiles: string[];
  /** TypeScript: .page.ts paths | Python: *_page.py paths */
  pomFiles: string[];
  pomFilesPreserved: number;
  skippedPages: number;
  totalScenarios: number;
  errors: { pageUrl: string; reason: string }[];
}

/**
 * Generate POM-based automation scripts for all test cases in the manifest.
 * Defaults to Python output; set language: "typescript" to generate TypeScript.
 */
export async function generateScriptsForSuite(
  opts: GenerateScriptsWorkflowOptions,
): Promise<GenerateScriptsWorkflowResult> {
  const { generationResult, project, role } = opts;
  const language = opts.language ?? "python";

  const outputDir =
    opts.outputDir ??
    path.join("tests", "generated", "scripts", slug(project), slug(role));

  if (language === "python") {
    const manifest = await generatePythonAutomationScripts({
      manifestPath: generationResult.manifestPath,
      outputDir,
      istqbAnnotations: opts.istqbAnnotations ?? true,
      overwritePom: opts.overwritePom ?? false,
    });

    return {
      language: "python",
      scriptsDir: manifest.scriptsDir,
      scriptsManifestPath: path.join(manifest.scriptsDir, "scripts-manifest-python.json"),
      specFiles: manifest.files.map((f) => f.testPath),
      pomFiles: manifest.files.map((f) => f.pagePath),
      pomFilesPreserved: manifest.totals.pageFilesPreserved,
      skippedPages: manifest.errors.length,
      totalScenarios: manifest.totals.scenariosTotal,
      errors: manifest.errors,
    };
  }

  // TypeScript output (original behaviour)
  const manifest: GenerateScriptsManifest = await generateAutomationScripts({
    manifestPath: generationResult.manifestPath,
    outputDir,
    istqbAnnotations: opts.istqbAnnotations ?? true,
    scenarioTimeoutMs: opts.scenarioTimeoutMs,
    overwritePom: opts.overwritePom ?? false,
  });

  return {
    language: "typescript",
    scriptsDir: manifest.scriptsDir,
    scriptsManifestPath: path.join(manifest.scriptsDir, "scripts-manifest.json"),
    specFiles: manifest.files.map((f) => f.specPath),
    pomFiles: manifest.files.map((f) => f.pomPath),
    pomFilesPreserved: manifest.totals.pomFilesPreserved,
    skippedPages: manifest.errors.length,
    totalScenarios: manifest.totals.scenariosTotal,
    errors: manifest.errors,
  };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
