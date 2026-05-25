/**
 * MCP Server — exposes the AI Automation Framework as MCP tools.
 *
 * OUTPUT ROUTING
 * ──────────────
 * By default every artefact (TCs, scripts, reports) is written into the
 * CALLER'S project directory, not into this framework's own folder.
 *
 * Priority (highest → lowest):
 *   1. `project_dir` argument in the individual tool call
 *   2. MCP_PROJECT_DIR environment variable (set in .vscode/mcp.json via
 *      "${workspaceFolder}" — VS Code substitutes this automatically)
 *   3. Current working directory fallback
 *
 * Layout inside project_dir:
 *   tests/generated/{project}/{role}/   ← YAML test cases
 *   tests/e2e/{project}/{role}/         ← Playwright .spec.ts + POM files
 *   reports/                            ← HTML / JSON / JUnit reports
 *
 * Internal/temporary artefacts (sitemaps, evidence screenshots) stay inside
 * the framework's own `reports/` so the caller's workspace stays clean.
 *
 * Tools
 * ─────
 *  analyze_page          – page structure introspection
 *  crawl_site            – BFS sitemap discovery
 *  generate_test_cases   – AI-designed ISTQB scenarios (YAML) → project_dir
 *  generate_test_scripts – Playwright POM codegen              → project_dir
 *  run_tests             – suite execution + reports           → project_dir
 *  run_full_workflow     – one-shot all of the above           → project_dir
 */

import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { analyzePage } from "../analyzer/analyze.js";
import { discoverSiteMap } from "../crawler/discover.js";
import { generateTestCasesFromSiteMap } from "../workflow/generate.js";
import { generateScriptsForSuite } from "../workflow/generate-scripts.js";
import { runTestCaseSuite } from "../workflow/run-suite.js";
import { FrameworkConfig, type ProviderName } from "../config.js";
import type { BrowserName } from "../browser/launcher.js";

// ─────────────────────────────────────────────────────────────────────────────
// Project config — ai-test.config.json in the user's project root
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectConfig {
  url?: string;
  project?: string;
  role?: string;
  provider?: string;
  max_pages?: number;
  max_depth?: number;
  scenarios_per_technique?: number;
  skip_non_functional?: boolean;
  a11y?: boolean;
  security_headers?: boolean;
}

async function readProjectConfig(projectDir: string): Promise<ProjectConfig> {
  // 1. ai-test.config.json (explicit)
  const jsonPath = path.join(projectDir, "ai-test.config.json");
  if (existsSync(jsonPath)) {
    try {
      return JSON.parse(await readFile(jsonPath, "utf8")) as ProjectConfig;
    } catch { /* ignore parse errors */ }
  }

  // 2. Auto-detect project name from package.json
  const pkgPath = path.join(projectDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
      return { project: pkg.name as string | undefined };
    } catch { /* ignore */ }
  }

  return {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Output-directory helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve where artefacts should land.
 * Returns absolute paths so downstream code works regardless of CWD.
 */
function resolveProjectDir(fromArg?: unknown): string {
  if (fromArg && typeof fromArg === "string" && fromArg.trim()) {
    return path.resolve(fromArg.trim());
  }
  if (process.env.MCP_PROJECT_DIR?.trim()) {
    return path.resolve(process.env.MCP_PROJECT_DIR.trim());
  }
  // Last resort: wherever the process is running
  return process.cwd();
}

function projectPaths(projectDir: string) {
  return {
    testsGenerated: path.join(projectDir, "tests", "generated"),
    testsE2e: path.join(projectDir, "tests", "e2e"),
    reports: path.join(projectDir, "reports"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FrameworkConfig builder
// ─────────────────────────────────────────────────────────────────────────────

function buildConfig(opts: {
  baseUrl: string;
  projectDir: string;
  headless?: boolean;
  provider?: string;
}): z.infer<typeof FrameworkConfig> {
  const provider = (
    opts.provider ??
    process.env.AI_TEST_DEFAULT_PROVIDER ??
    "gemini"
  ) as ProviderName;

  const dirs = projectPaths(opts.projectDir);

  return FrameworkConfig.parse({
    baseUrl: opts.baseUrl,
    reportsDir: dirs.reports,
    evidenceDir: path.join(dirs.reports, "evidence"),
    testsGeneratedDir: dirs.testsGenerated,
    runner: {
      headless: opts.headless ?? true,
      workers: 1,
      stepTimeoutMs: 10_000,
      navigationTimeoutMs: 30_000,
      captureScreenshotOnSuccess: false,
    },
    generation: {
      maxScenarios: 25,
      scenariosPerTechnique: 3,
      scenariosPerNfCategory: 2,
      categories: [],
    },
    report: { maskKeys: [], screenshotDiffThreshold: 0.001 },
    testEnv: { allowedHosts: [], defaultViewport: { width: 1280, height: 800 } },
    ai: {
      defaultProvider: provider,
      providers: { [provider]: { enabled: true } },
      fallbackChain: {},
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared input schema fragment (project_dir appears in every tool)
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_DIR_PROP = {
  project_dir: {
    type: "string",
    description:
      "Absolute path to the project being tested. TCs, scripts and reports are written here. " +
      "Defaults to MCP_PROJECT_DIR env var (set automatically by VS Code via ${workspaceFolder}).",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: "analyze_page",
    description:
      "Open a web page with a headless browser and extract its structure: " +
      "forms, interactive elements, navigation links, and semantic roles.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL of the page to analyze" },
        headless: { type: "boolean", description: "Run browser headless (default: true)" },
        storage_state_path: {
          type: "string",
          description: "Playwright storage-state JSON for authenticated sessions",
        },
        ...PROJECT_DIR_PROP,
      },
      required: ["url"],
    },
  },

  {
    name: "crawl_site",
    description:
      "BFS-crawl a website from a URL. Discovers pages respecting robots.txt. " +
      "Returns a sitemap JSON (internal artifact, used as input to generate_test_cases).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Entry URL to crawl" },
        max_pages: { type: "number", description: "Max pages to fetch (default: 50)" },
        max_depth: { type: "number", description: "Max link depth (default: 3)" },
        storage_state_path: { type: "string", description: "Playwright storage-state for auth" },
        ignore_robots: { type: "boolean", description: "Ignore robots.txt (default: false)" },
      },
      required: ["url"],
    },
  },

  {
    name: "generate_test_cases",
    description:
      "Use AI (ISTQB-CTFL v4.0) to design functional + non-functional test scenarios for " +
      "every page in a sitemap. Writes YAML files to {project_dir}/tests/generated/.",
    inputSchema: {
      type: "object",
      properties: {
        sitemap_path: {
          type: "string",
          description: "Path to the sitemap JSON produced by crawl_site",
        },
        url: { type: "string", description: "Base URL of the application" },
        project: { type: "string", description: "Project name (used in folder structure)" },
        role: {
          type: "string",
          description: "Role/persona (e.g. admin, guest). Default: default",
        },
        scenarios_per_technique: {
          type: "number",
          description: "Scenarios per ISTQB technique per page (default: 3)",
        },
        skip_non_functional: {
          type: "boolean",
          description: "Skip a11y/security/performance scenarios (default: false)",
        },
        provider: {
          type: "string",
          description: "AI provider: gemini | claude | codex | mock",
        },
        ...PROJECT_DIR_PROP,
      },
      required: ["sitemap_path", "url", "project"],
    },
  },

  {
    name: "generate_test_scripts",
    description:
      "Generate Playwright POM scripts (.spec.ts + .page.ts) from test case manifests. " +
      "Writes to {project_dir}/tests/e2e/. Run with: npx playwright test.",
    inputSchema: {
      type: "object",
      properties: {
        manifest_path: {
          type: "string",
          description: "Path to manifest.json produced by generate_test_cases",
        },
        cases_dir: {
          type: "string",
          description: "Directory containing the generated YAML test cases",
        },
        project: { type: "string", description: "Project name" },
        role: { type: "string", description: "Role name. Default: default" },
        overwrite_pom: {
          type: "boolean",
          description: "Overwrite existing POM files (default: false — preserves hand-edits)",
        },
        ...PROJECT_DIR_PROP,
      },
      required: ["manifest_path", "cases_dir", "project"],
    },
  },

  {
    name: "run_tests",
    description:
      "Execute a generated test-case suite with Playwright. " +
      "Writes HTML, JSON, and JUnit reports to {project_dir}/reports/.",
    inputSchema: {
      type: "object",
      properties: {
        cases_dir: { type: "string", description: "Directory of YAML test cases to run" },
        url: { type: "string", description: "Base URL of the application under test" },
        sitemap_path: { type: "string", description: "Sitemap JSON to filter pages" },
        project: { type: "string", description: "Project name" },
        role: { type: "string", description: "Role name. Default: default" },
        headless: { type: "boolean", description: "Run browser headless (default: true)" },
        browsers: {
          type: "array",
          items: { type: "string" },
          description: "Browser matrix: chromium | firefox | webkit (default: [chromium])",
        },
        a11y: { type: "boolean", description: "Run accessibility checks (default: false)" },
        security_headers: {
          type: "boolean",
          description: "Check security response headers (default: false)",
        },
        storage_state_path: { type: "string", description: "Playwright storage-state" },
        ...PROJECT_DIR_PROP,
      },
      required: ["cases_dir", "url"],
    },
  },

  {
    name: "run_full_workflow",
    description:
      "One-shot end-to-end workflow for ANY web project: " +
      "crawl → AI generates ISTQB test cases → Playwright scripts → run tests → reports. " +
      "All outputs (TCs, scripts, reports) are written to {project_dir}. " +
      "project_dir defaults to MCP_PROJECT_DIR env (VS Code sets this to ${workspaceFolder}).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Base URL of the application to test" },
        project: { type: "string", description: "Project name (used in paths and reports)" },
        role: { type: "string", description: "Role/persona name. Default: default" },
        max_pages: { type: "number", description: "Max pages to crawl (default: 20)" },
        max_depth: { type: "number", description: "Crawl depth (default: 2)" },
        scenarios_per_technique: {
          type: "number",
          description: "Scenarios per ISTQB technique (default: 3)",
        },
        skip_non_functional: {
          type: "boolean",
          description: "Skip non-functional test generation (default: false)",
        },
        headless: { type: "boolean", description: "Run browser headless (default: true)" },
        provider: {
          type: "string",
          description: "AI provider: gemini | claude | codex | mock",
        },
        storage_state_path: { type: "string", description: "Playwright storage-state for auth" },
        a11y: { type: "boolean", description: "Accessibility checks (default: false)" },
        security_headers: { type: "boolean", description: "Security header checks (default: false)" },
        ...PROJECT_DIR_PROP,
      },
      required: ["url", "project"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleAnalyzePage(args: Record<string, unknown>) {
  const projectDir = resolveProjectDir(args.project_dir);
  const screenshotPath = path.join(projectDir, "reports", "evidence", "mcp-analyze.png");
  await mkdir(path.dirname(screenshotPath), { recursive: true });

  const analysis = await analyzePage({
    url: String(args.url),
    screenshotPath,
    headless: args.headless !== false,
    storageStatePath: args.storage_state_path ? String(args.storage_state_path) : undefined,
  });

  return {
    url: analysis.finalUrl,
    title: analysis.title,
    screenshot: screenshotPath,
    forms: analysis.forms.length,
    elements: analysis.elements.length,
    navigation_links: analysis.navigation.length,
    summary:
      `Analyzed ${analysis.finalUrl} — ` +
      `${analysis.forms.length} form(s), ` +
      `${analysis.elements.length} element(s), ` +
      `${analysis.navigation.length} nav link(s)`,
    analysis,
  };
}

async function handleCrawlSite(args: Record<string, unknown>) {
  // Sitemap is an internal artifact → stays in framework's own reports/
  const evidenceRoot = path.join("reports", "evidence", `mcp-crawl-${Date.now()}`);
  await mkdir(evidenceRoot, { recursive: true });

  const siteMap = await discoverSiteMap({
    entryUrl: String(args.url),
    config: {
      maxPages: Number(args.max_pages ?? 50),
      maxDepth: Number(args.max_depth ?? 3),
      ignoreRobots: args.ignore_robots === true,
    },
    storageStatePath: args.storage_state_path ? String(args.storage_state_path) : undefined,
    evidenceRoot,
  });

  // discoverSiteMap always writes to reports/sitemaps/{crawlId}.json (relative to CWD)
  const sitemapPath = path.resolve("reports", "sitemaps", `${siteMap.crawlId}.json`);

  return {
    crawl_id: siteMap.crawlId,
    sitemap_path: sitemapPath,
    pages_found: siteMap.totals.unique,
    pages_fetched: siteMap.totals.fetched,
    pages_skipped: siteMap.totals.skipped,
    exit_reason: siteMap.exitReason,
    pages: siteMap.pages.map((p) => ({
      url: p.normalizedUrl,
      title: p.title,
      depth: p.depth,
    })),
    summary: `Crawled ${siteMap.totals.unique} page(s) from ${args.url} (${siteMap.exitReason})`,
  };
}

async function handleGenerateTestCases(args: Record<string, unknown>) {
  const projectDir = resolveProjectDir(args.project_dir);
  const dirs = projectPaths(projectDir);

  const cfg = buildConfig({
    baseUrl: String(args.url),
    projectDir,
    provider: args.provider ? String(args.provider) : undefined,
  });

  const project = String(args.project);
  const role = String(args.role ?? "default");

  const result = await generateTestCasesFromSiteMap({
    siteMapPath: String(args.sitemap_path),
    cfg,
    project,
    role,
    // Write YAMLs into the caller's project
    outputDir: path.join(dirs.testsGenerated, project, role),
    scenariosPerTechnique: args.scenarios_per_technique
      ? Number(args.scenarios_per_technique)
      : undefined,
    nonFunctionalCategories: args.skip_non_functional === true ? false : undefined,
  });

  return {
    project_dir: projectDir,
    cases_dir: result.casesDir,
    manifest_path: result.manifestPath,
    files_generated: result.files.length,
    total_scenarios: result.files.reduce((s, f) => s + f.scenarioCount, 0),
    errors: result.errors,
    files: result.files.map((f) => ({
      page_url: f.pageUrl,
      file: f.filePath,
      scenarios: f.scenarioCount,
    })),
    summary:
      `Generated ${result.files.reduce((s, f) => s + f.scenarioCount, 0)} scenario(s) ` +
      `across ${result.files.length} page(s) → ${result.casesDir}`,
  };
}

async function handleGenerateTestScripts(args: Record<string, unknown>) {
  const projectDir = resolveProjectDir(args.project_dir);
  const dirs = projectPaths(projectDir);

  const manifestPath = String(args.manifest_path);
  const casesDir = String(args.cases_dir);
  const project = String(args.project);
  const role = String(args.role ?? "default");

  const manifestRaw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);

  const result = await generateScriptsForSuite({
    generationResult: {
      casesDir,
      manifestPath,
      files: manifest.files ?? [],
      errors: manifest.errors ?? [],
    },
    project,
    role,
    // Write .spec.ts + POM files into the caller's project
    outputDir: path.join(dirs.testsE2e, project, role),
    istqbAnnotations: true,
    overwritePom: args.overwrite_pom === true,
  });

  return {
    project_dir: projectDir,
    scripts_dir: result.scriptsDir,
    spec_files: result.specFiles,
    pom_files: result.pomFiles,
    pom_files_preserved: result.pomFilesPreserved,
    total_scenarios: result.totalScenarios,
    skipped_pages: result.skippedPages,
    errors: result.errors,
    summary:
      `Generated ${result.specFiles.length} spec + ${result.pomFiles.length} POM file(s) ` +
      `→ ${result.scriptsDir}`,
  };
}

async function handleRunTests(args: Record<string, unknown>) {
  const projectDir = resolveProjectDir(args.project_dir);

  const cfg = buildConfig({
    baseUrl: String(args.url),
    projectDir,
    headless: args.headless !== false,
  });

  const result = await runTestCaseSuite({
    cfg,
    casesDir: String(args.cases_dir),
    siteMapPath: args.sitemap_path ? String(args.sitemap_path) : undefined,
    storageStatePath: args.storage_state_path ? String(args.storage_state_path) : undefined,
    project: args.project ? String(args.project) : undefined,
    role: args.role ? String(args.role) : undefined,
    browsers: Array.isArray(args.browsers)
      ? (args.browsers as BrowserName[])
      : ["chromium"],
    nonFunctional: {
      a11y: args.a11y === true,
      securityHeaders: args.security_headers === true,
    },
    junit: true,
    testPlan: true,
  });

  return {
    project_dir: projectDir,
    run_id: result.runId,
    html_report: result.htmlPath,
    json_report: result.jsonPath,
    junit_report: result.junitPath,
    test_plan: result.testPlanPath,
    totals: result.totals,
    files_run: result.filesRun.length,
    files_skipped: result.filesSkipped.length,
    summary:
      `Run ${result.runId}: ${result.totals.passed}/${result.totals.total} passed, ` +
      `${result.totals.failed} failed → ${result.htmlPath}`,
  };
}

async function handleRunFullWorkflow(args: Record<string, unknown>) {
  const projectDir = resolveProjectDir(args.project_dir);
  const dirs = projectPaths(projectDir);

  const url = String(args.url);
  const project = String(args.project);
  const role = String(args.role ?? "default");
  const provider = args.provider ? String(args.provider) : undefined;
  const headless = args.headless !== false;

  const steps: string[] = [];
  steps.push(`output → ${projectDir}`);

  // ── Step 1: Crawl (internal artifact) ────────────────────────────────────
  steps.push("crawling site...");
  const evidenceRoot = path.join("reports", "evidence", `mcp-wf-${Date.now()}`);
  await mkdir(evidenceRoot, { recursive: true });

  const siteMap = await discoverSiteMap({
    entryUrl: url,
    config: {
      maxPages: Number(args.max_pages ?? 20),
      maxDepth: Number(args.max_depth ?? 2),
    },
    storageStatePath: args.storage_state_path ? String(args.storage_state_path) : undefined,
    evidenceRoot,
  });
  const siteMapPath = path.resolve("reports", "sitemaps", `${siteMap.crawlId}.json`);
  steps.push(`crawled ${siteMap.totals.unique} page(s)`);

  // ── Step 2: Generate test cases → project_dir/tests/generated/ ───────────
  steps.push("generating AI test cases...");
  const cfg = buildConfig({ baseUrl: url, projectDir, headless, provider });

  const generated = await generateTestCasesFromSiteMap({
    siteMapPath,
    cfg,
    project,
    role,
    outputDir: path.join(dirs.testsGenerated, project, role),
    scenariosPerTechnique: args.scenarios_per_technique
      ? Number(args.scenarios_per_technique)
      : undefined,
    nonFunctionalCategories: args.skip_non_functional === true ? false : undefined,
    storageStatePath: args.storage_state_path ? String(args.storage_state_path) : undefined,
    fallbackSmoke: true,
  });
  const totalScenarios = generated.files.reduce((s, f) => s + f.scenarioCount, 0);
  steps.push(`generated ${totalScenarios} scenario(s) → ${generated.casesDir}`);

  if (!generated.files.length) {
    return {
      success: false,
      project_dir: projectDir,
      steps,
      error: "No test cases generated — check AI provider credentials and site accessibility",
    };
  }

  // ── Step 3: Generate Playwright scripts → project_dir/tests/e2e/ ─────────
  steps.push("generating Playwright scripts...");
  let scriptsResult;
  try {
    scriptsResult = await generateScriptsForSuite({
      generationResult: generated,
      project,
      role,
      outputDir: path.join(dirs.testsE2e, project, role),
      istqbAnnotations: true,
      overwritePom: false,
    });
    steps.push(
      `${scriptsResult.specFiles.length} spec + ${scriptsResult.pomFiles.length} POM → ${scriptsResult.scriptsDir}`,
    );
  } catch (err) {
    steps.push(`scripts skipped: ${(err as Error).message.slice(0, 80)}`);
  }

  // ── Step 4: Run tests, reports → project_dir/reports/ ────────────────────
  steps.push("running test suite...");
  const runResult = await runTestCaseSuite({
    cfg,
    casesDir: generated.casesDir,
    siteMapPath,
    storageStatePath: args.storage_state_path ? String(args.storage_state_path) : undefined,
    project,
    role,
    browsers: ["chromium"],
    nonFunctional: {
      a11y: args.a11y === true,
      securityHeaders: args.security_headers === true,
    },
    junit: true,
    testPlan: true,
  });
  steps.push(
    `${runResult.totals.passed}/${runResult.totals.total} passed → ${runResult.htmlPath}`,
  );

  return {
    success: true,
    project_dir: projectDir,
    steps,
    outputs: {
      test_cases: generated.casesDir,
      scripts: scriptsResult?.scriptsDir ?? null,
      html_report: runResult.htmlPath,
      json_report: runResult.jsonPath,
      junit_report: runResult.junitPath,
      test_plan: runResult.testPlanPath,
    },
    totals: runResult.totals,
    summary: [
      `project_dir : ${projectDir}`,
      `pages crawled    : ${siteMap.totals.unique}`,
      `scenarios        : ${totalScenarios}`,
      `results          : ${runResult.totals.passed} passed / ${runResult.totals.failed} failed / ${runResult.totals.total} total`,
      ``,
      `test cases  → ${generated.casesDir}`,
      `scripts     → ${scriptsResult?.scriptsDir ?? "skipped"}`,
      `HTML report → ${runResult.htmlPath}`,
      `JUnit       → ${runResult.junitPath ?? "n/a"}`,
    ].join("\n"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Server bootstrap
// ─────────────────────────────────────────────────────────────────────────────

export async function createMcpServer(): Promise<Server> {
  const server = new Server(
    { name: "ai-automation-framework", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      let result: unknown;
      switch (name) {
        case "analyze_page":
          result = await handleAnalyzePage(args as Record<string, unknown>);
          break;
        case "crawl_site":
          result = await handleCrawlSite(args as Record<string, unknown>);
          break;
        case "generate_test_cases":
          result = await handleGenerateTestCases(args as Record<string, unknown>);
          break;
        case "generate_test_scripts":
          result = await handleGenerateTestScripts(args as Record<string, unknown>);
          break;
        case "run_tests":
          result = await handleRunTests(args as Record<string, unknown>);
          break;
        case "run_full_workflow":
          result = await handleRunFullWorkflow(args as Record<string, unknown>);
          break;
        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
