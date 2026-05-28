/**
 * Python Script Writer — POM-based pytest files
 *
 * Output structure:
 *   tests/generated/scripts/<project>/<role>/
 *     conftest.py               ← pytest fixtures (written once)
 *     pytest.ini                ← pytest config (written once)
 *     requirements.txt          ← pip dependencies (written once)
 *     pages/
 *       __init__.py
 *       base_page.py            ← BasePage (written once)
 *       <slug>_page.py          ← Page Object (protected from overwrite)
 *     tests/
 *       __init__.py
 *       test_<slug>.py          ← pytest test class (AUTO+CUSTOM zones)
 *     scripts-manifest.json
 */

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { parseTestCaseFile } from "../scenario/parse";
import { generatePythonScript } from "./python-codegen";
import type { ExecutableScenario } from "../validation";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GeneratePythonScriptsOptions {
  /** Path to manifest.json produced by generateTestCasesFromSiteMap */
  manifestPath: string;
  /** Root output directory for pages/ and tests/ (default: tests/generated/scripts/<project>/<role>) */
  outputDir?: string;
  /** ISTQB annotations in test docstrings (default true) */
  istqbAnnotations?: boolean;
  /** Overwrite existing page object files (default false) */
  overwritePom?: boolean;
}

export interface GeneratePythonScriptsManifest {
  project: string;
  role: string;
  generatedAt: string;
  casesManifestPath: string;
  scriptsDir: string;
  files: GeneratedPythonFile[];
  errors: { pageUrl: string; reason: string }[];
  totals: {
    pages: number;
    scenariosTotal: number;
    scenariosSkipped: number;
    filesWritten: number;
    pageFilesWritten: number;
    pageFilesPreserved: number;
  };
}

export interface GeneratedPythonFile {
  pageUrl: string;
  pagePath: string;
  testPath: string;
  scenarioCount: number;
  skippedCount: number;
  pageOverwritten: boolean;
}

interface CasesManifest {
  project: string;
  role: string;
  files: {
    pageUrl: string;
    filePath: string;
    scenariosPath?: string;
    scenarioCount: number;
  }[];
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function generatePythonAutomationScripts(
  opts: GeneratePythonScriptsOptions,
): Promise<GeneratePythonScriptsManifest> {
  const manifestRaw = await readFile(opts.manifestPath, "utf8");
  const casesManifest: CasesManifest = JSON.parse(manifestRaw);

  const manifestDir = path.dirname(opts.manifestPath);
  const scriptsDir =
    opts.outputDir ??
    path.join(
      "tests", "generated", "scripts",
      slug(casesManifest.project), slug(casesManifest.role),
    );

  const pagesDir = path.join(scriptsDir, "pages");
  const testsDir = path.join(scriptsDir, "tests");

  await mkdir(pagesDir, { recursive: true });
  await mkdir(testsDir, { recursive: true });

  // Write one-time scaffold files
  await ensureScaffoldFiles(scriptsDir, pagesDir, testsDir);

  const files: GeneratedPythonFile[] = [];
  const errors: { pageUrl: string; reason: string }[] = [];
  let totalScenarios = 0;
  let totalSkipped = 0;
  let pageWritten = 0;
  let pagePreserved = 0;

  for (const caseFile of casesManifest.files) {
    const caseFilePath = path.isAbsolute(caseFile.filePath)
      ? caseFile.filePath
      : path.resolve(manifestDir, caseFile.filePath);

    let scenarios: ExecutableScenario[];
    try {
      if (caseFile.scenariosPath) {
        const jsonPath = path.isAbsolute(caseFile.scenariosPath)
          ? caseFile.scenariosPath
          : path.resolve(manifestDir, caseFile.scenariosPath);
        scenarios = JSON.parse(await readFile(jsonPath, "utf8")) as ExecutableScenario[];
      } else {
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
      generated = generatePythonScript(scenarios, {
        pageSlugName: baseName,
        istqbAnnotations: opts.istqbAnnotations ?? true,
      });
    } catch (err) {
      errors.push({ pageUrl: caseFile.pageUrl, reason: `codegen: ${(err as Error).message.slice(0, 200)}` });
      continue;
    }

    // Page Object file — protected from overwrite unless --overwrite-pom
    const pagePath = path.join(pagesDir, `${generated.pageModuleName}.py`);
    const pageExists = await fileExists(pagePath);
    let pageOverwritten = false;
    if (!pageExists || opts.overwritePom) {
      await writeFile(pagePath, generated.pageCode, "utf8");
      pageWritten++;
      pageOverwritten = pageExists;
    } else {
      pagePreserved++;
    }

    // Test file — always overwrite AUTO zone, preserve CUSTOM zone
    const testPath = path.join(testsDir, `${generated.testModuleName}.py`);
    const testExists = await fileExists(testPath);
    const finalTestCode = testExists
      ? await mergeTestFile(testPath, generated.testCode)
      : generated.testCode;
    await writeFile(testPath, finalTestCode, "utf8");

    totalScenarios += scenarios.length;
    totalSkipped += generated.skippedScenarios.length;

    files.push({
      pageUrl: caseFile.pageUrl,
      pagePath,
      testPath,
      scenarioCount: scenarios.length - generated.skippedScenarios.length,
      skippedCount: generated.skippedScenarios.length,
      pageOverwritten,
    });
  }

  const manifest: GeneratePythonScriptsManifest = {
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
      pageFilesWritten: pageWritten,
      pageFilesPreserved: pagePreserved,
    },
  };

  await writeFile(
    path.join(scriptsDir, "scripts-manifest-python.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  return manifest;
}

// ---------------------------------------------------------------------------
// Smart test file merger: preserve CUSTOM zone when re-generating
// ---------------------------------------------------------------------------

const AUTO_START = "# ──── ai-test:auto-start ────";
const AUTO_END   = "# ──── ai-test:auto-end ────";
const CUSTOM_START = "# ──── ai-test:custom-start ────";

async function mergeTestFile(existingPath: string, newCode: string): Promise<string> {
  const existing = await readFile(existingPath, "utf8");
  const customIdx = existing.indexOf(CUSTOM_START);
  if (customIdx === -1) return newCode;  // no custom zone — full overwrite

  const customZone = existing.slice(customIdx);

  // Replace everything from auto-end onward with the custom zone
  const autoEndInNew = newCode.indexOf(AUTO_END);
  if (autoEndInNew === -1) return newCode;

  const newAutoZone = newCode.slice(0, autoEndInNew + AUTO_END.length);
  return newAutoZone + "\n\n\n" + customZone;
}

// ---------------------------------------------------------------------------
// Scaffold files written once (never overwritten)
// ---------------------------------------------------------------------------

async function ensureScaffoldFiles(
  scriptsDir: string,
  pagesDir: string,
  testsDir: string,
): Promise<void> {
  await ensureFile(path.join(scriptsDir, "conftest.py"), CONFTEST_PY);
  await ensureFile(path.join(scriptsDir, "pytest.ini"), PYTEST_INI);
  await ensureFile(path.join(scriptsDir, "requirements.txt"), REQUIREMENTS_TXT);
  await ensureFile(path.join(pagesDir, "__init__.py"), PY_INIT);
  await ensureFile(path.join(pagesDir, "base_page.py"), BASE_PAGE_PY);
  await ensureFile(path.join(testsDir, "__init__.py"), PY_INIT);
}

async function ensureFile(p: string, content: string): Promise<void> {
  if (await fileExists(p)) return;
  await writeFile(p, content, "utf8");
}

// ---------------------------------------------------------------------------
// Scaffold file contents
// ---------------------------------------------------------------------------

const CONFTEST_PY = `"""
Pytest configuration and shared fixtures.

pytest-playwright provides: page, browser, context, browser_type fixtures.
Override base_url to point at a different environment:

    BASE_URL=https://staging.example.com pytest

Or set it in pytest.ini / .env.
"""
from __future__ import annotations

import os

import pytest


@pytest.fixture(scope="session")
def base_url() -> str:  # type: ignore[override]
    """Base URL injected into every page fixture."""
    return os.getenv("BASE_URL", "http://localhost:3000")


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args: dict) -> dict:  # type: ignore[override]
    """Shared browser context settings."""
    return {
        **browser_context_args,
        "viewport": {"width": 1280, "height": 800},
    }
`;

const PYTEST_INI = `[pytest]
# ai-automation-framework — pytest-playwright configuration
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*

# Playwright options — override with CLI flags or env vars
# --headed           show browser window
# --slowmo=500       slow down actions by 500 ms
# --browser=firefox  run against a different engine
addopts =
    --screenshot=only-on-failure
    --video=retain-on-failure
    --tracing=retain-on-failure
    --output=test-results
`;

const REQUIREMENTS_TXT = `# ai-automation-framework — Python Playwright dependencies
# Install: pip install -r requirements.txt
# Or:      pip install playwright pytest-playwright
#          playwright install chromium

playwright>=1.44.0
pytest>=8.0.0
pytest-playwright>=0.5.0
`;

const PY_INIT = ``;

const BASE_PAGE_PY = `"""
BasePage — shared navigation and utility helpers for all Page Objects.

All generated Page Objects inherit from this class.
Add project-wide helper methods here (e.g. wait_for_toast, dismiss_cookie_banner).
"""
from __future__ import annotations

from playwright.sync_api import Locator, Page


class BasePage:
    """Base Page Object with common Playwright helpers."""

    def __init__(self, page: Page) -> None:
        self.page = page

    def goto(self, url: str) -> None:
        """Navigate to an arbitrary URL."""
        self.page.goto(url)

    def wait_for_network_idle(self) -> None:
        """Wait until no network requests are in flight."""
        self.page.wait_for_load_state("networkidle")

    def wait_for_dom(self) -> None:
        """Wait until the DOM is interactive."""
        self.page.wait_for_load_state("domcontentloaded")

    def reload(self) -> None:
        """Hard-reload the current page."""
        self.page.reload()

    def get_title(self) -> str:
        """Return the current page <title>."""
        return self.page.title()
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
