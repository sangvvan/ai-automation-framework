import { describe, expect, it } from "vitest";
import { RunSummary, ScenarioResult, ValidationResult } from "./result";

const sampleScenarioResult: ScenarioResult = {
  scenarioId: "TC_LOGIN_001",
  status: "passed",
  steps: [{ index: 0, status: "passed", durationMs: 12 }],
  startedAt: "2026-05-17T10:00:00.000Z",
  finishedAt: "2026-05-17T10:00:01.000Z",
  consoleMessages: [],
};

describe("ScenarioResult schema", () => {
  it("accepts a passed result", () => {
    expect(ScenarioResult.parse(sampleScenarioResult).status).toBe("passed");
  });

  it("rejects unknown status", () => {
    expect(() =>
      ScenarioResult.parse({ ...sampleScenarioResult, status: "blocked" }),
    ).toThrow();
  });
});

describe("ValidationResult schema", () => {
  it("accepts a failed validation with checks", () => {
    const v = ValidationResult.parse({
      scenarioId: "TC",
      status: "failed",
      checks: [
        { name: "url", status: "failed", detail: "expected /a got /b" },
      ],
      failureReason: "URL mismatch",
    });
    expect(v.checks).toHaveLength(1);
  });
});

describe("RunSummary schema", () => {
  it("accepts a run summary", () => {
    const r = RunSummary.parse({
      runId: "R-001",
      mode: "testcase",
      startedAt: "2026-05-17T10:00:00.000Z",
      finishedAt: "2026-05-17T10:00:05.000Z",
      totals: { total: 1, passed: 1, failed: 0, skipped: 0 },
      scenarios: [],
      environment: {},
    });
    expect(r.totals.total).toBe(1);
  });
});
