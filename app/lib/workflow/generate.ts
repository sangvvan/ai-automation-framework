import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzePage } from "../analyzer/analyze";
import { buildProvider } from "../ai/factory";
import { designScenarios } from "../ai/agents/test-design";
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
  maxScenariosPerPage?: number;
  categories?: string[];
  storageStatePath?: string;
  fallbackSmoke?: boolean;
}

export interface GeneratedCaseFile {
  pageUrl: string;
  filePath: string;
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

      let scenarios: ExecutableScenario[];
      try {
        scenarios = await designScenarios({
          analysis,
          provider,
          maxScenarios: opts.maxScenariosPerPage ?? opts.cfg.generation.maxScenarios,
          categories: opts.categories ?? opts.cfg.generation.categories,
        });
      } catch (err) {
        if (opts.fallbackSmoke === false) throw err;
        scenarios = [buildSmokeScenario(analysis.finalUrl, pageKey)];
      }
      // Also fall back to smoke when the provider returned 0 scenarios
      // (e.g. MockProvider with no fixtures swallows per-technique
      // failures and yields an empty array rather than throwing).
      if (scenarios.length === 0 && opts.fallbackSmoke !== false) {
        scenarios = [buildSmokeScenario(analysis.finalUrl, pageKey)];
      }

      const filePath = path.join(casesDir, `${pageKey}.yaml`);
      await writeFile(filePath, scenariosToYaml(page.normalizedUrl, scenarios));
      files.push({ pageUrl: page.normalizedUrl, filePath, scenarioCount: scenarios.length });
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
