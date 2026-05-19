import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderAggregateHtml, writeWorkflowAggregate, type WorkflowAggregate } from "./workflow-aggregate";

const sample: WorkflowAggregate = {
  workflowId: "W-2026",
  project: "shop",
  baseUrl: "https://shop.example.com",
  startedAt: "2026-05-19T01:00:00.000Z",
  finishedAt: "2026-05-19T01:05:00.000Z",
  totals: { total: 12, passed: 9, failed: 2, skipped: 1 },
  roles: [
    {
      roleName: "anonymous",
      runId: "R-anon",
      totals: { total: 4, passed: 4, failed: 0, skipped: 0 },
      htmlPath: "reports/html/R-anon/index.html",
      junitPath: "reports/junit/R-anon.xml",
      testPlanPath: "reports/test-plans/R-anon.json",
      defectsInserted: 0,
      durationMs: 8200,
    },
    {
      roleName: "customer",
      runId: "R-cust",
      totals: { total: 5, passed: 3, failed: 2, skipped: 0 },
      htmlPath: "reports/html/R-cust/index.html",
      defectsInserted: 2,
      durationMs: 124_000,
    },
    {
      roleName: "admin",
      runId: "R-admin",
      totals: { total: 3, passed: 2, failed: 0, skipped: 1 },
      htmlPath: "reports/html/R-admin/index.html",
      prCommentUrl: "https://github.com/owner/repo/pull/42#issuecomment-1",
      defectsInserted: 0,
      durationMs: 45_000,
    },
  ],
};

describe("renderAggregateHtml", () => {
  it("renders KPIs, donut, per-role bars and table", () => {
    const html = renderAggregateHtml(sample);
    expect(html).toContain("W-2026");
    expect(html).toContain("shop");
    expect(html).toContain("Per-role pass-rate");
    // donut text shows the total
    expect(html).toContain(">12<");
    // each role appears
    for (const r of sample.roles) {
      expect(html).toContain(r.roleName);
      expect(html).toContain(r.runId);
    }
    // pass rate label for admin (2/3 ~ 67%)
    expect(html).toMatch(/67%\s+\(2\/3\)/);
  });

  it("does not pull any external resource", () => {
    const html = renderAggregateHtml(sample);
    expect(html).not.toMatch(/https?:\/\/[^\s"']*cdn/i);
    expect(html).not.toContain("<script src=");
  });

  it("includes the PR comment link when present", () => {
    const html = renderAggregateHtml(sample);
    expect(html).toMatch(/href="https:\/\/github\.com\/owner\/repo\/pull\/42/);
  });
});

describe("writeWorkflowAggregate", () => {
  it("writes summary.json + index.html", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ai-test-wf-"));
    const { summaryPath, htmlPath } = await writeWorkflowAggregate(sample, {
      reportsDir: dir,
    });
    expect(existsSync(summaryPath)).toBe(true);
    expect(existsSync(htmlPath)).toBe(true);
    expect(summaryPath.endsWith("workflows/W-2026/summary.json")).toBe(true);
    const json = JSON.parse(readFileSync(summaryPath, "utf8"));
    expect(json.totals.total).toBe(12);
    expect(json.roles).toHaveLength(3);
  });
});
