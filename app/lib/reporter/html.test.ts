import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderHtml, writeHtmlReport } from "./html";
import type { RunSummary } from "../validation";

const failedSummary: RunSummary = {
  runId: "R-html-1",
  mode: "explore",
  startedAt: "2026-05-17T10:00:00.000Z",
  finishedAt: "2026-05-17T10:00:01.000Z",
  totals: { total: 1, passed: 0, failed: 1, skipped: 0 },
  environment: { node: "v22" },
  scenarios: [
    {
      scenario: {
        id: "SC1",
        title: "Open page",
        type: "positive",
        priority: "P1",
        pageUrl: "https://x",
        origin: "ai-generated",
        warnings: [],
        steps: [
          {
            index: 0,
            description: "Open page",
            action: { keyword: "open_page", url: "https://x" },
            resolved: true,
          },
        ],
        expectedResult: { text: "Welcome" },
      },
      result: {
        scenarioId: "SC1",
        status: "failed",
        steps: [{ index: 0, status: "failed", durationMs: 10, reason: "timeout" }],
        startedAt: "2026-05-17T10:00:00.000Z",
        finishedAt: "2026-05-17T10:00:01.000Z",
        consoleMessages: [],
      },
      validation: {
        scenarioId: "SC1",
        status: "failed",
        checks: [{ name: "execution", status: "failed", detail: "timeout" }],
        failureReason: "timeout",
        suggestedDefect: {
          summary: "Scenario SC1 failed: timeout",
          stepsToReproduce: ["Step 0: failed"],
          evidenceLinks: [],
          severity: "high",
        },
      },
    },
  ],
};

describe("HTML reporter", () => {
  it("renders title and failure detail", () => {
    const html = renderHtml(failedSummary);
    expect(html).toContain("R-html-1");
    expect(html).toContain("timeout");
    expect(html).toContain("Open page");
  });

  it("writes a self-contained HTML file", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ai-html-"));
    const p = await writeHtmlReport(failedSummary, { reportsDir: dir });
    const text = readFileSync(p, "utf8");
    expect(text).not.toContain("<script src=");
    expect(text).not.toContain("cdn.");
  });

  it("renders regression diff when previous summary supplied", () => {
    const previous: RunSummary = {
      ...failedSummary,
      runId: "R-prev",
      scenarios: [
        {
          ...failedSummary.scenarios[0],
          validation: { ...failedSummary.scenarios[0].validation, status: "passed" },
        },
      ],
    };
    const html = renderHtml(failedSummary, previous);
    expect(html).toContain("Regression diff");
    expect(html).toContain("new failures");
  });
});
