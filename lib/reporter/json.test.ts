import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeJsonReport } from "./json";
import type { RunSummary } from "../validation";

const summary: RunSummary = {
  runId: "R-test-1",
  mode: "testcase",
  app: "https://example.com",
  startedAt: "2026-05-17T10:00:00.000Z",
  finishedAt: "2026-05-17T10:00:05.000Z",
  totals: { total: 1, passed: 1, failed: 0, skipped: 0 },
  scenarios: [
    {
      scenario: {
        id: "TC_LOGIN",
        title: "login",
        type: "positive",
        priority: "P1",
        pageUrl: "https://example.com/login",
        origin: "testcase-yaml",
        warnings: [],
        steps: [
          {
            index: 0,
            description: "fill password",
            action: {
              keyword: "fill",
              target: { kind: "label", text: "Password" },
              value: "MySecret123",
            },
            resolved: true,
          },
        ],
        expectedResult: {},
      },
      result: {
        scenarioId: "TC_LOGIN",
        status: "passed",
        steps: [{ index: 0, status: "passed", durationMs: 5 }],
        startedAt: "2026-05-17T10:00:00.000Z",
        finishedAt: "2026-05-17T10:00:01.000Z",
        consoleMessages: [],
      },
      validation: {
        scenarioId: "TC_LOGIN",
        status: "passed",
        checks: [{ name: "execution", status: "passed" }],
      },
    },
  ],
  environment: {},
};

describe("JSON reporter", () => {
  it("writes a JSON file and masks password fill values", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ai-json-"));
    const p = await writeJsonReport(summary, { reportsDir: dir });
    expect(p.endsWith("R-test-1.json")).toBe(true);
    const text = readFileSync(p, "utf8");
    expect(text).not.toContain("MySecret123");
    expect(text).toContain("***");
  });
});
