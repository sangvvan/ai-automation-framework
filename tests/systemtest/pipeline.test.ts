/**
 * Framework-level system test (SPRINT-006 close-out).
 *
 * Boots the fixture sample-app HTTP server, then drives the real
 * `ai-test` pipeline (crawl → run testcase + explore-fallback) against
 * it with a real Playwright Chromium. Asserts the full set of artefacts
 * (SiteMap, JSON report, HTML report, JUnit XML, TestPlan, evidence
 * directory) and the runtime invariants for each.
 *
 * Run with: `npm run test:framework-system`
 *
 * Prerequisites:
 *   - Chromium installed (`npx playwright install chromium`) — Playwright
 *     1.60 expects revision 1223 by default; PLAYWRIGHT_BROWSERS_PATH
 *     can point to a pre-existing install.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { discoverSiteMap } from "../../lib/crawler/discover";
import { parseTestCaseFile } from "../../lib/scenario/parse";
import { mapStepsToActions } from "../../lib/scenario/step-mapper";
import { analyzePage } from "../../lib/analyzer/analyze";
import { runScenarios } from "../../lib/runner/runner";
import { validateScenarioResult } from "../../lib/validator/validate";
import { writeJsonReport } from "../../lib/reporter/json";
import { writeHtmlReport } from "../../lib/reporter/html";
import { writeJunitReport } from "../../lib/reporter/junit";
import { generateAndWriteTestPlan } from "../../lib/reporter/test-plan-generator";
import { assembleSuites } from "../../lib/review/suite-assembler";
import {
  RunSummary,
  SiteMap,
  type ExecutableScenario,
} from "../../lib/validation";
import type { FrameworkConfig } from "../../lib/config";

const PORT = 47710 + Math.floor(Math.random() * 50);
const BASE = `http://127.0.0.1:${PORT}`;

let server: ChildProcess | undefined;
let tmpReports: string;

const cfg: FrameworkConfig = {
  baseUrl: BASE,
  reportsDir: "",
  testsApprovedDir: "tests/approved",
  testsRegressionDir: "tests/regression",
  testsGeneratedDir: "tests/generated",
  evidenceDir: "",
  runner: {
    workers: 1,
    headless: true,
    viewport: { width: 1280, height: 800 },
    stepTimeoutMs: 8000,
    navigationTimeoutMs: 15000,
    captureScreenshotOnSuccess: false,
  },
  generation: { maxScenarios: 5, categories: [] },
  report: { screenshotDiffThreshold: 0.001, maskKeys: [] },
  testEnv: { allowedHosts: [], defaultViewport: { width: 1280, height: 800 } },
  ai: { defaultProvider: "mock", providers: { mock: { enabled: true, timeoutMs: 1000 } }, fallbackChain: {} },
};

async function waitForHttp(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) resolve();
          else reject(new Error(`status ${res.statusCode}`));
        });
        req.on("error", reject);
        req.setTimeout(1000, () => req.destroy(new Error("timeout")));
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Server never came up at ${url}`);
}

beforeAll(async () => {
  tmpReports = mkdtempSync(path.join(os.tmpdir(), "ai-test-sys-"));
  cfg.reportsDir = tmpReports;
  cfg.evidenceDir = path.join(tmpReports, "evidence");

  server = spawn(
    process.execPath,
    [path.resolve("tests/fixtures/sample-app/server.mjs")],
    { env: { ...process.env, FIXTURE_PORT: String(PORT) }, stdio: "ignore" },
  );
  await waitForHttp(`${BASE}/login.html`);
}, 60_000);

afterAll(() => {
  server?.kill("SIGTERM");
  if (tmpReports && existsSync(tmpReports)) {
    rmSync(tmpReports, { recursive: true, force: true });
  }
});

describe("crawler against the fixture sample-app", () => {
  it("discovers the entry page + linked navigation pages", async () => {
    const sm = await discoverSiteMap({
      entryUrl: BASE + "/",
      config: { maxPages: 10, maxDepth: 2, perHostQps: 10 },
      evidenceRoot: path.join(cfg.evidenceDir, "crawl"),
    });
    expect(sm.totals.fetched).toBeGreaterThanOrEqual(2); // index + login/search
    const paths = sm.pages.map((p) => new URL(p.normalizedUrl).pathname);
    expect(paths).toContain("/login.html");
    expect(SiteMap.safeParse(sm).success).toBe(true);
    expect(sm.exitReason).toBe("done");
  });
});

describe("end-to-end pipeline (testcase mode) against fixture login page", () => {
  it("runs login YAML through analyze→map→runner→validator and emits every artefact", async () => {
    const runId = `R-sys-${Date.now()}`;
    const evidenceDir = path.join(cfg.evidenceDir, runId);

    // 1. Parse the bundled YAML, but retarget to our random fixture port.
    const yamlPath = path.resolve("tests/fixtures/test-cases/login.yaml");
    const raw = readFileSync(yamlPath, "utf8").replace(
      "http://127.0.0.1:4710",
      BASE,
    );
    const tmpYaml = path.join(tmpReports, "login.yaml");
    require("node:fs").writeFileSync(tmpYaml, raw);

    const parsed = await parseTestCaseFile(tmpYaml);
    expect(parsed).toHaveLength(1);
    const scenario = parsed[0];

    // 2. Analyze the page so step-mapper has grounding.
    const analysis = await analyzePage({
      url: scenario.pageUrl,
      viewport: cfg.runner.viewport,
      screenshotPath: path.join(evidenceDir, "page.png"),
      headless: true,
      navigationTimeoutMs: cfg.runner.navigationTimeoutMs,
    });
    expect(analysis.elements.length).toBeGreaterThan(0);

    const mapped = mapStepsToActions(scenario.steps, analysis, scenario.pageUrl);
    const scenarios: ExecutableScenario[] = [
      { ...scenario, steps: mapped.steps, warnings: mapped.warnings },
    ];

    // 3. Run with non-functional checks ON to validate the wiring.
    const { results } = await runScenarios(scenarios, {
      headless: true,
      stepTimeoutMs: cfg.runner.stepTimeoutMs,
      navigationTimeoutMs: cfg.runner.navigationTimeoutMs,
      viewport: cfg.runner.viewport,
      evidenceDir,
      captureScreenshotOnSuccess: false,
      nonFunctional: { a11y: false, vitals: true, securityHeaders: true },
    });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("passed");
    expect(results[0].browser).toBe("chromium");
    // Web Vitals were captured (TTFB at minimum since we observed a nav).
    expect(results[0].webVitals).toBeDefined();
    // Security headers handler ran (may report missing headers; that's OK).
    // The fixture HTTP server doesn't set CSP/HSTS, so we expect warnings.
    expect(results[0].securityChecks?.length ?? 0).toBeGreaterThan(0);

    // 4. Validate against the YAML's expected result.
    const validations = results.map((r, i) =>
      validateScenarioResult(r, scenarios[i].expectedResult),
    );
    expect(validations[0].status).toBe("passed");

    // 5. Assemble suites + emit every artefact.
    const assembled = assembleSuites(scenarios);
    const suiteGrouping = {
      names: Object.fromEntries(assembled.map((s) => [s.tempId, s.name])),
      members: Object.fromEntries(
        assembled.map((s) => [s.tempId, s.scenarios.map((sc) => sc.id)]),
      ),
    };

    const summary = {
      runId,
      mode: "testcase" as const,
      app: BASE,
      testLevel: "system" as const,
      startedAt: results[0].startedAt,
      finishedAt: results[0].finishedAt,
      totals: {
        total: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
      },
      scenarios: scenarios.map((s, i) => ({
        scenario: s,
        result: results[i],
        validation: validations[i],
      })),
      environment: { node: process.version },
      techniqueCoverage: [
        { technique: scenario.designTechnique ?? "error-guessing", total: 1, passed: 1 },
      ],
    };
    expect(RunSummary.safeParse(summary).success).toBe(true);

    const jsonPath = await writeJsonReport(summary, {
      reportsDir: cfg.reportsDir,
      maskKeys: [],
    });
    const htmlPath = await writeHtmlReport(summary, {
      reportsDir: cfg.reportsDir,
      maskKeys: [],
    });
    const junitPath = await writeJunitReport(summary, {
      reportsDir: cfg.reportsDir,
      suites: suiteGrouping,
    });
    const planPath = await generateAndWriteTestPlan({
      summary,
      cfg,
      reportsDir: cfg.reportsDir,
    });

    // 6. Every artefact exists + has the right shape.
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(htmlPath)).toBe(true);
    expect(existsSync(junitPath)).toBe(true);
    expect(existsSync(planPath)).toBe(true);

    const html = readFileSync(htmlPath, "utf8");
    expect(html).toContain(runId);
    expect(html).toContain("Login with valid credentials");
    expect(html).toContain("ISTQB Technique Coverage");

    const xml = readFileSync(junitPath, "utf8");
    expect(xml).toMatch(/<testsuites name="/);
    expect(xml).toMatch(/tests="1"/);
    expect(xml).toMatch(/failures="0"/);

    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    expect(plan.id).toBe(runId);
    expect(plan.levels).toContain("system");
    expect(plan.types).toContain("functional");

    // 7. Password value never leaks into ANY artefact (JSON, HTML, JUnit).
    const reportJson = readFileSync(jsonPath, "utf8");
    expect(reportJson).not.toContain("password123");
    expect(reportJson).toContain("***");
    expect(readFileSync(htmlPath, "utf8")).not.toContain("password123");
    expect(readFileSync(junitPath, "utf8")).not.toContain("password123");

    // 8. Evidence captured: trace.zip + page.png exist.
    const traceFile = path.join(evidenceDir, scenario.id, "trace.zip");
    expect(existsSync(traceFile)).toBe(true);
    expect(existsSync(path.join(evidenceDir, "page.png"))).toBe(true);
  }, 60_000);
});
