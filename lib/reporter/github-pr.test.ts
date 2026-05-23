import { describe, expect, it } from "vitest";
import { buildBody, readGithubPrEnvFromProcess } from "./github-pr";
import type { RunSummary } from "../validation";

const summary: RunSummary = {
  runId: "R-2026",
  mode: "explore",
  testLevel: "system",
  startedAt: "2026-05-17T10:00:00.000Z",
  finishedAt: "2026-05-17T10:00:30.000Z",
  totals: { total: 3, passed: 1, failed: 2, skipped: 0 },
  techniqueCoverage: [],
  scenarios: [
    {
      scenario: {
        id: "S1",
        title: "Login happy",
        type: "positive",
        priority: "P1",
        pageUrl: "https://x",
        steps: [
          {
            index: 0,
            description: "open",
            action: { keyword: "open_page", url: "https://x" },
            resolved: true,
          },
        ],
        expectedResult: {},
        origin: "ai-generated",
        warnings: [],
      },
      result: {
        scenarioId: "S1",
        status: "passed",
        steps: [],
        startedAt: "2026-05-17T10:00:00.000Z",
        finishedAt: "2026-05-17T10:00:01.000Z",
        consoleMessages: [],
      },
      validation: { scenarioId: "S1", status: "passed", checks: [] },
    },
    {
      scenario: {
        id: "S2",
        title: "Boundary fail",
        type: "boundary",
        priority: "P1",
        pageUrl: "https://x",
        steps: [
          {
            index: 0,
            description: "open",
            action: { keyword: "open_page", url: "https://x" },
            resolved: true,
          },
        ],
        expectedResult: {},
        origin: "ai-generated",
        warnings: [],
      },
      result: {
        scenarioId: "S2",
        status: "failed",
        steps: [],
        startedAt: "2026-05-17T10:00:01.000Z",
        finishedAt: "2026-05-17T10:00:02.000Z",
        consoleMessages: [],
      },
      validation: {
        scenarioId: "S2",
        status: "failed",
        checks: [],
        failureReason: "step 0 timeout",
      },
    },
    {
      scenario: {
        id: "S3",
        title: "Decision-table 2",
        type: "negative",
        priority: "P2",
        pageUrl: "https://x",
        steps: [
          {
            index: 0,
            description: "open",
            action: { keyword: "open_page", url: "https://x" },
            resolved: true,
          },
        ],
        expectedResult: {},
        origin: "ai-generated",
        warnings: [],
      },
      result: {
        scenarioId: "S3",
        status: "failed",
        steps: [],
        startedAt: "2026-05-17T10:00:02.000Z",
        finishedAt: "2026-05-17T10:00:03.000Z",
        consoleMessages: [],
      },
      validation: {
        scenarioId: "S3",
        status: "failed",
        checks: [],
        failureReason: "expected /home got /login",
      },
    },
  ],
  environment: {},
};

describe("buildBody", () => {
  it("includes totals + first failures + artefact links + marker", () => {
    const body = buildBody(
      summary,
      { htmlReport: "reports/html/R-2026/index.html", junit: "reports/junit/R-2026.xml" },
      "<!-- ai-test:summary:R-2026 -->",
    );
    expect(body).toMatch(/1\/3 passed, 2 failed/);
    expect(body).toMatch(/Boundary fail/);
    expect(body).toMatch(/Decision-table 2/);
    expect(body).toMatch(/reports\/html\/R-2026\/index\.html/);
    expect(body).toMatch(/<!-- ai-test:summary:R-2026 -->/);
  });

  it("notes when artefacts are missing", () => {
    const body = buildBody(summary, {}, "<!--m-->");
    expect(body).toMatch(/HTML report: \(not generated\)/);
  });
});

describe("readGithubPrEnvFromProcess", () => {
  it("returns null when env is missing", () => {
    const original = { ...process.env };
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_PR_NUMBER;
    delete process.env.GITHUB_REF;
    expect(readGithubPrEnvFromProcess()).toBeNull();
    Object.assign(process.env, original);
  });

  it("parses pr number from GITHUB_REF when GITHUB_PR_NUMBER absent", () => {
    process.env.GITHUB_TOKEN = "t";
    process.env.GITHUB_REPOSITORY = "owner/repo";
    delete process.env.GITHUB_PR_NUMBER;
    delete process.env.PR_NUMBER;
    process.env.GITHUB_REF = "refs/pull/42/merge";
    const env = readGithubPrEnvFromProcess();
    expect(env?.prNumber).toBe(42);
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_REF;
  });
});
