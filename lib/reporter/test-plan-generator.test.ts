import { describe, expect, it } from "vitest";
import { generateTestPlan } from "./test-plan-generator";
import type { RunSummary, FrameworkConfig } from "../validation";
import type { FrameworkConfig as FwCfg } from "../config";

const cfg = {
  baseUrl: "http://localhost:3000",
  reportsDir: "reports",
  testsApprovedDir: "tests/approved",
  testsRegressionDir: "tests/regression",
  testsGeneratedDir: "tests/generated",
  evidenceDir: "reports/evidence",
  runner: {
    workers: 1,
    headless: true,
    viewport: { width: 1280, height: 800 },
    stepTimeoutMs: 10000,
    navigationTimeoutMs: 30000,
    captureScreenshotOnSuccess: false,
  },
  generation: { maxScenarios: 10, categories: [] },
  report: { screenshotDiffThreshold: 0.001, maskKeys: [] },
  testEnv: { allowedHosts: [], defaultViewport: { width: 1280, height: 800 } },
  ai: { defaultProvider: "mock", providers: {}, fallbackChain: {} },
} as unknown as FwCfg;

const summary: RunSummary = {
  runId: "R-1",
  mode: "explore",
  app: "https://example.com",
  testLevel: "system",
  startedAt: "2026-05-17T10:00:00.000Z",
  finishedAt: "2026-05-17T10:00:30.000Z",
  totals: { total: 1, passed: 1, failed: 0, skipped: 0 },
  techniqueCoverage: [],
  scenarios: [
    {
      scenario: {
        id: "S1",
        title: "Smoke",
        type: "positive",
        priority: "P1",
        pageUrl: "https://example.com",
        steps: [
          {
            index: 0,
            description: "open",
            action: { keyword: "open_page", url: "https://example.com" },
            resolved: true,
          },
        ],
        expectedResult: {},
        origin: "ai-generated",
        warnings: [],
        designTechnique: "error-guessing",
      },
      result: {
        scenarioId: "S1",
        status: "passed",
        steps: [{ index: 0, status: "passed", durationMs: 10 }],
        startedAt: "2026-05-17T10:00:00.000Z",
        finishedAt: "2026-05-17T10:00:01.000Z",
        consoleMessages: [],
        accessibilityViolations: [],
        securityChecks: [],
      },
      validation: { scenarioId: "S1", status: "passed", checks: [] },
    },
  ],
  environment: {},
};

// Ensure the type-only re-export from validation matches what we expect.
type _TypeCheck = FwCfg;

describe("generateTestPlan", () => {
  it("emits a deterministic Plan with required sections", async () => {
    const plan = await generateTestPlan({ summary, cfg });
    expect(plan.id).toBe("R-1");
    expect(plan.levels).toContain("system");
    expect(plan.types).toContain("functional");
    expect(plan.scope.inScope.length).toBeGreaterThanOrEqual(1);
    expect(plan.entryCriteria.length).toBeGreaterThan(0);
    expect(plan.exitCriteria.length).toBeGreaterThan(0);
  });

  it("uses a custom approach when supplied", async () => {
    const plan = await generateTestPlan({ summary, cfg, approach: "Custom narrative." });
    expect(plan.approach).toBe("Custom narrative.");
  });

  it("derives the accessibility type when violations exist", async () => {
    const s2: RunSummary = {
      ...summary,
      scenarios: [
        {
          ...summary.scenarios[0],
          result: {
            ...summary.scenarios[0].result,
            accessibilityViolations: [
              {
                id: "color-contrast",
                impact: "serious",
                wcagLevel: "AA",
                help: "Insufficient contrast",
                nodes: [],
              },
            ],
          },
        },
      ],
    };
    const plan = await generateTestPlan({ summary: s2, cfg });
    expect(plan.types).toContain("accessibility");
  });
});
