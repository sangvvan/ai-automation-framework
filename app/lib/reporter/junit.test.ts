import { describe, expect, it } from "vitest";
import { renderJunit } from "./junit";
import type { RunSummary } from "../validation";

const summary: RunSummary = {
  runId: "R-1",
  mode: "explore",
  startedAt: "2026-05-17T10:00:00.000Z",
  finishedAt: "2026-05-17T10:00:05.000Z",
  testLevel: "system",
  totals: { total: 3, passed: 1, failed: 1, skipped: 1 },
  techniqueCoverage: [],
  scenarios: [
    {
      scenario: {
        id: "S1",
        title: "Open page",
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
    {
      scenario: {
        id: "S2",
        title: "Bad page",
        type: "negative",
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
        designTechnique: "boundary-value",
      },
      result: {
        scenarioId: "S2",
        status: "failed",
        steps: [{ index: 0, status: "failed", durationMs: 5, reason: "timeout" }],
        startedAt: "2026-05-17T10:00:01.000Z",
        finishedAt: "2026-05-17T10:00:02.000Z",
        consoleMessages: [],
        accessibilityViolations: [],
        securityChecks: [],
      },
      validation: {
        scenarioId: "S2",
        status: "failed",
        checks: [{ name: "execution", status: "failed", category: "functional" }],
        failureReason: "timeout",
      },
    },
    {
      scenario: {
        id: "S3",
        title: "Skipped",
        type: "ui",
        priority: "P3",
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
        designTechnique: "error-guessing",
      },
      result: {
        scenarioId: "S3",
        status: "skipped",
        steps: [{ index: 0, status: "skipped", durationMs: 0 }],
        startedAt: "2026-05-17T10:00:02.000Z",
        finishedAt: "2026-05-17T10:00:02.000Z",
        consoleMessages: [],
        accessibilityViolations: [],
        securityChecks: [],
      },
      validation: { scenarioId: "S3", status: "passed", checks: [] },
    },
  ],
  environment: {},
};

describe("renderJunit", () => {
  it("emits a root testsuites element with totals", () => {
    const xml = renderJunit(summary);
    expect(xml).toContain('<testsuites name="R-1"');
    expect(xml).toContain('tests="3"');
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('skipped="1"');
  });

  it("emits failure block with the reason", () => {
    const xml = renderJunit(summary);
    expect(xml).toMatch(/<failure[^>]*message="timeout"/);
    expect(xml).toContain("AssertionFailure");
  });

  it("emits a single Default suite when no grouping passed", () => {
    const xml = renderJunit(summary);
    expect(xml).toContain('<testsuite name="Default"');
  });

  it("respects suite grouping", () => {
    const xml = renderJunit(summary, {
      names: { a: "Auth", b: "Other" },
      members: { a: ["S1", "S2"], b: ["S3"] },
    });
    expect(xml).toContain('<testsuite name="Auth"');
    expect(xml).toContain('<testsuite name="Other"');
  });
});
