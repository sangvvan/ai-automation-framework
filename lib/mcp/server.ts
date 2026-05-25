/**
 * MCP Server — exposes the AI Automation Framework as a set of MCP tools so
 * any MCP-compatible client (Claude Desktop, VS Code, custom agents, etc.)
 * can connect and run the full test-generation / execution workflow.
 *
 * Transport: stdio  (add --http flag in the entrypoint script for HTTP/SSE).
 *
 * Exposed tools
 * ─────────────
 *  analyze_page          – Analyze a single web page (elements, forms, …)
 *  crawl_site            – BFS crawl a site → sitemap JSON
 *  generate_test_cases   – AI-design ISTQB scenarios from a sitemap
 *  generate_test_scripts – Emit Playwright POM .spec.ts files from a manifest
 *  run_tests             – Execute a test-case suite → JSON / HTML report
 *  run_full_workflow     – One-shot: crawl → generate TCs → scripts → run → report
 */

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
// Config builder — constructs a minimal FrameworkConfig from tool arguments.
// The MCP server does NOT require yaml config files on disk; everything comes
// from tool inputs + env vars (CLAUDE_API_KEY, etc.).
// ─────────────────────────────────────────────────────────────────────────────

function buildConfig(opts: {
  baseUrl: string;
  reportsDir?: string;
  headless?: boolean;
  provider?: string;
}): z.infer<typeof FrameworkConfig> {
  const provider = (opts.provider ?? process.env.AI_TEST_DEFAULT_PROVIDER ?? "claude") as ProviderName;

  return FrameworkConfig.parse({
    baseUrl: opts.baseUrl,
    reportsDir: opts.reportsDir ?? "reports",
    evidenceDir: path.join(opts.reportsDir ?? "reports", "evidence"),
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
      providers: {
        [provider]: { enabled: true },
      },
      fallbackChain: {},
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: "analyze_page",
    description:
      "Open a web page with a headless browser and extract its structure: forms, interactive elements, navigation links, and semantic roles. Returns a PageAnalysis object and saves a screenshot.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL of the page to analyze" },
        screenshot_path: {
          type: "string",
          description: "Where to save the screenshot (default: reports/evidence/page.png)",
        },
        headless: {
          type: "boolean",
          description: "Run browser in headless mode (default: true)",
        },
        storage_state_path: {
          type: "string",
          description: "Path to a Playwright storage-state JSON for authenticated sessions",
        },
      },
      required: ["url"],
    },
  },

  {
    name: "crawl_site",
    description:
      "BFS-crawl a website starting from a URL. Discovers pages respecting robots.txt and scope rules. Returns a sitemap JSON saved to disk.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Entry URL to crawl" },
        max_pages: {
          type: "number",
          description: "Maximum pages to fetch (default: 50)",
        },
        max_depth: {
          type: "number",
          description: "Maximum link depth (default: 3)",
        },
        storage_state_path: {
          type: "string",
          description: "Playwright storage-state for authenticated crawls",
        },
        ignore_robots: {
          type: "boolean",
          description: "Ignore robots.txt (default: false)",
        },
        reports_dir: {
          type: "string",
          description: "Output directory for sitemaps (default: reports)",
        },
      },
      required: ["url"],
    },
  },

  {
    name: "generate_test_cases",
    description:
      "Use AI (ISTQB-CTFL v4.0 techniques) to design functional and non-functional test scenarios for every page in a sitemap. Returns YAML test-case files and a manifest.",
    inputSchema: {
      type: "object",
      properties: {
        sitemap_path: {
          type: "string",
          description: "Path to the sitemap JSON produced by crawl_site",
        },
        url: {
          type: "string",
          description: "Base URL of the application (required for config)",
        },
        project: {
          type: "string",
          description: "Project name used to organize output files",
        },
        role: {
          type: "string",
          description: "Role/persona name (e.g. admin, guest)",
          default: "default",
        },
        output_dir: {
          type: "string",
          description: "Override directory for generated YAML files",
        },
        scenarios_per_technique: {
          type: "number",
          description: "Scenarios per ISTQB technique per page (default: 3)",
        },
        skip_non_functional: {
          type: "boolean",
          description: "Skip a11y/security/performance/usability scenarios (default: false)",
        },
        provider: {
          type: "string",
          description: "AI provider to use: claude | gemini | codex | mock (default: claude)",
        },
        reports_dir: {
          type: "string",
          description: "Evidence output directory (default: reports)",
        },
      },
      required: ["sitemap_path", "url", "project"],
    },
  },

  {
    name: "generate_test_scripts",
    description:
      "Generate Playwright POM-based automation scripts (.spec.ts + .page.ts) from generated test case manifests. These scripts can be run directly with `npx playwright test`.",
    inputSchema: {
      type: "object",
      properties: {
        manifest_path: {
          type: "string",
          description: "Path to the manifest.json produced by generate_test_cases",
        },
        cases_dir: {
          type: "string",
          description: "Directory containing the generated YAML test cases",
        },
        project: {
          type: "string",
          description: "Project name (used in output path)",
        },
        role: {
          type: "string",
          description: "Role name (used in output path)",
          default: "default",
        },
        output_dir: {
          type: "string",
          description: "Override output directory for .spec.ts files",
        },
        overwrite_pom: {
          type: "boolean",
          description: "Overwrite existing POM files (default: false — preserves hand-edits)",
        },
      },
      required: ["manifest_path", "cases_dir", "project"],
    },
  },

  {
    name: "run_tests",
    description:
      "Execute a generated test-case suite. Runs Playwright scenarios, validates results, and emits JSON, HTML, and JUnit reports.",
    inputSchema: {
      type: "object",
      properties: {
        cases_dir: {
          type: "string",
          description: "Directory of YAML test cases to run",
        },
        url: {
          type: "string",
          description: "Base URL of the application under test",
        },
        sitemap_path: {
          type: "string",
          description: "Optional sitemap JSON to filter which pages to test",
        },
        project: { type: "string", description: "Project name" },
        role: {
          type: "string",
          description: "Role name",
          default: "default",
        },
        headless: {
          type: "boolean",
          description: "Run browser headless (default: true)",
        },
        browsers: {
          type: "array",
          items: { type: "string" },
          description: "Browser matrix: [chromium, firefox, webkit] (default: [chromium])",
        },
        a11y: {
          type: "boolean",
          description: "Run accessibility checks (default: false)",
        },
        security_headers: {
          type: "boolean",
          description: "Check security response headers (default: false)",
        },
        reports_dir: {
          type: "string",
          description: "Output directory for reports (default: reports)",
        },
        storage_state_path: {
          type: "string",
          description: "Playwright storage-state for authenticated runs",
        },
      },
      required: ["cases_dir", "url"],
    },
  },

  {
    name: "run_full_workflow",
    description:
      "End-to-end workflow: crawl the site → generate AI test cases → generate Playwright scripts → execute tests → produce HTML/JSON/JUnit reports. This is the single-call shortcut to get a complete test report.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Base URL of the application to test",
        },
        project: {
          type: "string",
          description: "Project identifier (used in file paths and reports)",
        },
        role: {
          type: "string",
          description: "Role/persona name (default: default)",
          default: "default",
        },
        max_pages: {
          type: "number",
          description: "Max pages to crawl (default: 20)",
        },
        max_depth: {
          type: "number",
          description: "Crawl depth limit (default: 2)",
        },
        scenarios_per_technique: {
          type: "number",
          description: "Scenarios per ISTQB technique (default: 3)",
        },
        skip_non_functional: {
          type: "boolean",
          description: "Skip non-functional test generation (default: false)",
        },
        headless: {
          type: "boolean",
          description: "Run browser headless (default: true)",
        },
        provider: {
          type: "string",
          description: "AI provider: claude | gemini | codex | mock (default: claude)",
        },
        storage_state_path: {
          type: "string",
          description: "Playwright storage-state for authenticated sessions",
        },
        reports_dir: {
          type: "string",
          description: "Root output directory (default: reports)",
        },
        a11y: {
          type: "boolean",
          description: "Run accessibility checks during test execution (default: false)",
        },
        security_headers: {
          type: "boolean",
          description: "Check security headers during test execution (default: false)",
        },
      },
      required: ["url", "project"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleAnalyzePage(args: Record<string, unknown>) {
  const url = String(args.url);
  const screenshotPath = String(
    args.screenshot_path ?? path.join("reports", "evidence", "mcp-analyze.png"),
  );
  await mkdir(path.dirname(screenshotPath), { recursive: true });

  const analysis = await analyzePage({
    url,
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
    summary: `Analyzed ${analysis.finalUrl} — ${analysis.forms.length} form(s), ${analysis.elements.length} interactive element(s), ${analysis.navigation.length} nav link(s)`,
    analysis,
  };
}

async function handleCrawlSite(args: Record<string, unknown>) {
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

  // discoverSiteMap always writes to reports/sitemaps/{crawlId}.json
  const sitemapPath = path.join("reports", "sitemaps", `${siteMap.crawlId}.json`);

  return {
    crawl_id: siteMap.crawlId,
    sitemap_path: sitemapPath,
    pages_found: siteMap.totals.unique,
    pages_fetched: siteMap.totals.fetched,
    pages_skipped: siteMap.totals.skipped,
    exit_reason: siteMap.exitReason,
    pages: siteMap.pages.map((p) => ({ url: p.normalizedUrl, title: p.title, depth: p.depth })),
    summary: `Crawled ${siteMap.totals.unique} unique page(s) from ${args.url} (${siteMap.exitReason})`,
  };
}

async function handleGenerateTestCases(args: Record<string, unknown>) {
  const cfg = buildConfig({
    baseUrl: String(args.url),
    reportsDir: args.reports_dir ? String(args.reports_dir) : undefined,
    provider: args.provider ? String(args.provider) : undefined,
  });

  const result = await generateTestCasesFromSiteMap({
    siteMapPath: String(args.sitemap_path),
    cfg,
    project: String(args.project),
    role: String(args.role ?? "default"),
    outputDir: args.output_dir ? String(args.output_dir) : undefined,
    scenariosPerTechnique: args.scenarios_per_technique ? Number(args.scenarios_per_technique) : undefined,
    nonFunctionalCategories: args.skip_non_functional === true ? false : undefined,
  });

  return {
    cases_dir: result.casesDir,
    manifest_path: result.manifestPath,
    files_generated: result.files.length,
    errors: result.errors.length,
    total_scenarios: result.files.reduce((sum, f) => sum + f.scenarioCount, 0),
    files: result.files.map((f) => ({
      page_url: f.pageUrl,
      file_path: f.filePath,
      scenarios: f.scenarioCount,
    })),
    generation_errors: result.errors,
    summary: `Generated ${result.files.reduce((s, f) => s + f.scenarioCount, 0)} scenario(s) across ${result.files.length} page(s). Manifest: ${result.manifestPath}`,
  };
}

async function handleGenerateTestScripts(args: Record<string, unknown>) {
  const manifestPath = String(args.manifest_path);
  const casesDir = String(args.cases_dir);

  // Read manifest to reconstruct GenerateSuiteResult
  const manifestRaw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);

  const generationResult = {
    casesDir,
    manifestPath,
    files: manifest.files ?? [],
    errors: manifest.errors ?? [],
  };

  const result = await generateScriptsForSuite({
    generationResult,
    project: String(args.project),
    role: String(args.role ?? "default"),
    outputDir: args.output_dir ? String(args.output_dir) : undefined,
    istqbAnnotations: true,
    overwritePom: args.overwrite_pom === true,
  });

  return {
    scripts_dir: result.scriptsDir,
    spec_files: result.specFiles,
    pom_files: result.pomFiles,
    pom_files_preserved: result.pomFilesPreserved,
    total_scenarios: result.totalScenarios,
    skipped_pages: result.skippedPages,
    errors: result.errors,
    summary: `Generated ${result.specFiles.length} spec + ${result.pomFiles.length} POM file(s) in ${result.scriptsDir}`,
  };
}

async function handleRunTests(args: Record<string, unknown>) {
  const cfg = buildConfig({
    baseUrl: String(args.url),
    reportsDir: args.reports_dir ? String(args.reports_dir) : undefined,
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
    run_id: result.runId,
    json_report: result.jsonPath,
    html_report: result.htmlPath,
    junit_report: result.junitPath,
    test_plan: result.testPlanPath,
    totals: result.totals,
    files_run: result.filesRun.length,
    files_skipped: result.filesSkipped.length,
    defects_found: result.defectsInserted,
    summary: `Run ${result.runId}: ${result.totals.passed}/${result.totals.total} passed, ${result.totals.failed} failed. HTML: ${result.htmlPath}`,
  };
}

async function handleRunFullWorkflow(args: Record<string, unknown>) {
  const url = String(args.url);
  const project = String(args.project);
  const role = String(args.role ?? "default");
  const reportsDir = String(args.reports_dir ?? "reports");
  const provider = args.provider ? String(args.provider) : undefined;
  const headless = args.headless !== false;

  const steps: string[] = [];

  // ── Step 1: Crawl ──────────────────────────────────────────────────────────
  steps.push("crawling site...");
  const evidenceRoot = path.join(reportsDir, "evidence", `mcp-workflow-${Date.now()}`);
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
  // discoverSiteMap always writes to reports/sitemaps/{crawlId}.json
  const siteMapPath = path.join("reports", "sitemaps", `${siteMap.crawlId}.json`);
  steps.push(`crawled ${siteMap.totals.unique} page(s)`);

  // ── Step 2: Generate test cases ────────────────────────────────────────────
  steps.push("generating test cases...");
  const cfg = buildConfig({ baseUrl: url, reportsDir, headless, provider });

  const generated = await generateTestCasesFromSiteMap({
    siteMapPath,
    cfg,
    project,
    role,
    scenariosPerTechnique: args.scenarios_per_technique ? Number(args.scenarios_per_technique) : undefined,
    nonFunctionalCategories: args.skip_non_functional === true ? false : undefined,
    storageStatePath: args.storage_state_path ? String(args.storage_state_path) : undefined,
    fallbackSmoke: true,
  });
  const totalScenarios = generated.files.reduce((s, f) => s + f.scenarioCount, 0);
  steps.push(`generated ${totalScenarios} scenario(s) in ${generated.files.length} file(s)`);

  if (!generated.files.length) {
    return {
      success: false,
      steps,
      error: "No test cases generated — check AI provider credentials and site accessibility",
    };
  }

  // ── Step 3: Generate Playwright scripts ────────────────────────────────────
  steps.push("generating Playwright scripts...");
  let scriptsResult;
  try {
    scriptsResult = await generateScriptsForSuite({
      generationResult: generated,
      project,
      role,
      istqbAnnotations: true,
      overwritePom: false,
    });
    steps.push(
      `generated ${scriptsResult.specFiles.length} spec + ${scriptsResult.pomFiles.length} POM file(s)`,
    );
  } catch (err) {
    steps.push(`scripts generation skipped: ${(err as Error).message.slice(0, 80)}`);
  }

  // ── Step 4: Run tests ──────────────────────────────────────────────────────
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
    `run ${runResult.runId}: ${runResult.totals.passed}/${runResult.totals.total} passed`,
  );

  return {
    success: true,
    steps,
    workflow: {
      project,
      role,
      url,
    },
    crawl: {
      crawl_id: siteMap.crawlId,
      sitemap_path: siteMapPath,
      pages_found: siteMap.totals.unique,
    },
    generation: {
      cases_dir: generated.casesDir,
      manifest_path: generated.manifestPath,
      files_generated: generated.files.length,
      total_scenarios: totalScenarios,
      errors: generated.errors.length,
    },
    scripts: scriptsResult
      ? {
          scripts_dir: scriptsResult.scriptsDir,
          spec_files: scriptsResult.specFiles.length,
          pom_files: scriptsResult.pomFiles.length,
        }
      : null,
    run: {
      run_id: runResult.runId,
      html_report: runResult.htmlPath,
      json_report: runResult.jsonPath,
      junit_report: runResult.junitPath,
      test_plan: runResult.testPlanPath,
      totals: runResult.totals,
    },
    summary: [
      `Project: ${project}  Role: ${role}  URL: ${url}`,
      `Pages crawled: ${siteMap.totals.unique}`,
      `Scenarios generated: ${totalScenarios}`,
      `Results: ${runResult.totals.passed} passed / ${runResult.totals.failed} failed / ${runResult.totals.total} total`,
      `HTML report: ${runResult.htmlPath}`,
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

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: message, stack }, null, 2),
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
