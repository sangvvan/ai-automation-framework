import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzePage } from "../analyzer/analyze";
import { buildProvider } from "../ai/factory";
import { designScenarios } from "../ai/agents/test-design";
import {
  designNonFunctionalScenarios,
  type NonFunctionalCategory,
} from "../ai/agents/non-functional-design";
import type { FrameworkConfig } from "../config";
import { SiteMap, type SiteMapPage } from "../validation/sitemap";
import type { ExecutableScenario } from "../validation";
import { safePathSegment } from "./config";
import { scenariosToYaml } from "./yaml";

export interface GenerateSuiteOptions {
  siteMapPath: string;
  cfg: FrameworkConfig;
  project: string;
  role: string;
  outputDir?: string;
  /** Total functional scenario ceiling per page (used to derive scenariosPerTechnique). */
  maxScenariosPerPage?: number;
  /**
   * Scenarios requested per ISTQB technique (default 3).
   * When set, overrides the maxScenariosPerPage ÷ technique-count calculation
   * so every technique always gets a fair budget.
   */
  scenariosPerTechnique?: number;
  categories?: string[];
  storageStatePath?: string;
  fallbackSmoke?: boolean;
  /**
   * Non-functional categories to generate test cases for.
   * Set to [] to skip non-functional generation.
   * Default: ["accessibility", "security", "performance", "usability", "compatibility"]
   */
  nonFunctionalCategories?: NonFunctionalCategory[] | false;
  /** Scenarios per non-functional category (default 2). */
  scenariosPerNfCategory?: number;
}

export interface GeneratedCaseFile {
  pageUrl: string;
  /** Path to the human-readable YAML test-case file */
  filePath: string;
  /**
   * Path to the full ExecutableScenario JSON sidecar.
   * Present for AI-generated cases; absent for human-authored files.
   * The script-writer reads this in preference to the YAML to preserve
   * structured action data (click, fill, select, etc.).
   */
  scenariosPath?: string;
  scenarioCount: number;
}

export interface GenerateSuiteResult {
  casesDir: string;
  manifestPath: string;
  files: GeneratedCaseFile[];
  errors: { pageUrl: string; reason: string }[];
}

export async function generateTestCasesFromSiteMap(
  opts: GenerateSuiteOptions,
): Promise<GenerateSuiteResult> {
  const raw = await readFile(opts.siteMapPath, "utf8");
  const siteMap = SiteMap.parse(JSON.parse(raw));
  const casesDir =
    opts.outputDir ??
    path.join("tests", "generated", safePathSegment(opts.project), safePathSegment(opts.role));
  await mkdir(casesDir, { recursive: true });

  const files: GeneratedCaseFile[] = [];
  const errors: { pageUrl: string; reason: string }[] = [];
  const storageStatePath = opts.storageStatePath ?? siteMap.storageStatePath;

  for (const page of siteMap.pages) {
    const pageKey = pageKeyFor(page);
    const evidenceDir = path.join(
      opts.cfg.evidenceDir,
      "generation",
      safePathSegment(opts.project),
      safePathSegment(opts.role),
      pageKey,
    );
    await mkdir(evidenceDir, { recursive: true });

    try {
      process.stdout.write(`  [AI Design] Designing test scenarios for page: ${page.normalizedUrl}...\n`);

      const analysis = await analyzePage({
        url: page.normalizedUrl,
        viewport: opts.cfg.runner.viewport,
        screenshotPath: path.join(evidenceDir, "page.png"),
        headless: opts.cfg.runner.headless,
        navigationTimeoutMs: opts.cfg.runner.navigationTimeoutMs,
        storageStatePath,
      });

      const provider = buildProvider({
        config: opts.cfg,
        role: "design",
        tracePath: path.join(evidenceDir, "ai-trace.jsonl"),
      });

      // ── Functional scenarios (all ISTQB techniques) ───────────────────────
      let functionalScenarios: ExecutableScenario[];
      try {
        functionalScenarios = await designScenarios({
          analysis,
          provider,
          maxScenarios: opts.maxScenariosPerPage ?? opts.cfg.generation.maxScenarios,
          scenariosPerTechnique:
            opts.scenariosPerTechnique ?? opts.cfg.generation.scenariosPerTechnique,
          categories: opts.categories ?? opts.cfg.generation.categories,
        });
      } catch (err) {
        if (opts.fallbackSmoke === false) throw err;
        functionalScenarios = [buildSmokeScenario(analysis.finalUrl, pageKey)];
      }
      if (functionalScenarios.length === 0 && opts.fallbackSmoke !== false) {
        functionalScenarios = [buildSmokeScenario(analysis.finalUrl, pageKey)];
      }

      // ── Non-functional scenarios (a11y, security, performance, ...) ────────
      let nfScenarios: ExecutableScenario[] = [];
      const nfCategories = opts.nonFunctionalCategories;
      if (nfCategories !== false) {
        try {
          nfScenarios = await designNonFunctionalScenarios({
            analysis,
            provider,
            categories:
              Array.isArray(nfCategories) && nfCategories.length
                ? nfCategories
                : undefined, // undefined → use ALL_NF_CATEGORIES default
            scenariosPerCategory:
              opts.scenariosPerNfCategory ?? opts.cfg.generation.scenariosPerNfCategory ?? 2,
          });
        } catch (err) {
          // Non-functional failures are non-fatal
          process.stderr.write(
            `  note: non-functional design skipped for ${page.normalizedUrl} (${(err as Error).message.slice(0, 100)})\n`,
          );
        }
      }

      const scenarios: ExecutableScenario[] = [...functionalScenarios, ...nfScenarios];

      const filePath = path.join(casesDir, `${pageKey}.yaml`);
      await writeFile(filePath, scenariosToYaml(page.normalizedUrl, scenarios));

      // ── Save full structured scenarios alongside the YAML ──────────────────
      // The YAML format stores only step descriptions (human-readable).
      // The JSON sidecar preserves the full ExecutableScenario graph so that
      // the script-writer can generate accurate Playwright actions (click, fill,
      // select, etc.) instead of falling back to TODO placeholders.
      const scenariosPath = path.join(casesDir, `${pageKey}.scenarios.json`);
      await writeFile(
        scenariosPath,
        JSON.stringify(scenarios, null, 2),
      );

      // Store paths RELATIVE TO casesDir so that script-writer.ts can resolve
      // them correctly via path.resolve(manifestDir, relativePath).
      // Storing CWD-relative paths (e.g. "tests/generated/localhost/admin/page.yaml")
      // would cause path.resolve(manifestDir, ...) to double the prefix.
      files.push({
        pageUrl: page.normalizedUrl,
        filePath: path.relative(casesDir, filePath),
        scenariosPath: path.relative(casesDir, scenariosPath),
        scenarioCount: scenarios.length,
      });
    } catch (err) {
      errors.push({ pageUrl: page.normalizedUrl, reason: (err as Error).message });
    }
  }

  const manifestPath = path.join(casesDir, "manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        project: opts.project,
        role: opts.role,
        siteMapPath: opts.siteMapPath,
        storageStatePath,
        generatedAt: new Date().toISOString(),
        files,
        errors,
      },
      null,
      2,
    ),
  );

  return { casesDir, manifestPath, files, errors };
}

function buildSmokeScenario(url: string, pageKey: string): ExecutableScenario {
  return {
    id: `SMOKE_${pageKey.toUpperCase()}`,
    title: `Open ${url} and verify URL`,
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
    expectedResult: { url },
    warnings: [],
  };
}

function pageKeyFor(page: SiteMapPage): string {
  const url = new URL(page.normalizedUrl);
  const pathPart = url.pathname === "/" ? "home" : safePathSegment(url.pathname);
  return `${pathPart}-${hash(page.normalizedUrl)}`;
}

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}
