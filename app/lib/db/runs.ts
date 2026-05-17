import { db } from "./client";
import type { RunSummary } from "../validation";

export interface RunRow {
  id: string;
  mode: "testcase" | "explore";
  app_url: string | null;
  started_at: string;
  finished_at: string;
  totals: { total: number; passed: number; failed: number; skipped: number };
  json_report: string;
  html_report: string;
  suite_tag: string | null;
}

export interface ScenarioRow {
  id: string;
  run_id: string;
  title: string;
  type: string;
  priority: string;
  page_url: string;
  origin: "testcase-yaml" | "testcase-md" | "ai-generated" | "approved";
  result_status: string;
  validation: unknown;
  review_status: "pending_review" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  in_regression: boolean;
  spec_yaml: string | null;
}

export const runsRepo = {
  async listRecent(limit = 50): Promise<RunRow[]> {
    return db.query<RunRow>(
      `SELECT id, mode, app_url, started_at, finished_at, totals,
              json_report, html_report, suite_tag
         FROM runs ORDER BY started_at DESC LIMIT $1`,
      [limit],
    );
  },
  async findById(id: string): Promise<RunRow | null> {
    return db.queryOne<RunRow>(
      `SELECT id, mode, app_url, started_at, finished_at, totals,
              json_report, html_report, suite_tag
         FROM runs WHERE id = $1`,
      [id],
    );
  },
  async listScenarios(runId: string): Promise<ScenarioRow[]> {
    return db.query<ScenarioRow>(
      `SELECT id, run_id, title, type, priority, page_url, origin,
              result_status, validation, review_status, reviewed_by,
              reviewed_at, reject_reason, in_regression, spec_yaml
         FROM scenarios WHERE run_id = $1 ORDER BY id`,
      [runId],
    );
  },
  async findScenario(runId: string, scenarioId: string): Promise<ScenarioRow | null> {
    return db.queryOne<ScenarioRow>(
      `SELECT id, run_id, title, type, priority, page_url, origin,
              result_status, validation, review_status, reviewed_by,
              reviewed_at, reject_reason, in_regression, spec_yaml
         FROM scenarios WHERE run_id = $1 AND id = $2`,
      [runId, scenarioId],
    );
  },
};

/** Persist a fresh RunSummary + its scenarios in one transaction. */
export async function persistRun(
  summary: RunSummary,
  paths: { jsonPath: string; htmlPath: string },
): Promise<void> {
  await db.transaction(async (client) => {
    await client.query(
      `INSERT INTO runs (id, mode, app_url, started_at, finished_at,
                         totals, json_report, html_report, suite_tag)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        summary.runId,
        summary.mode,
        summary.app ?? null,
        summary.startedAt,
        summary.finishedAt,
        JSON.stringify(summary.totals),
        paths.jsonPath,
        paths.htmlPath,
        summary.suiteTag ?? null,
      ],
    );
    for (const s of summary.scenarios) {
      const id = `${summary.runId}::${s.scenario.id}`;
      const reviewStatus =
        s.scenario.origin === "ai-generated" ? "pending_review" : "approved";
      await client.query(
        `INSERT INTO scenarios (id, run_id, title, type, priority, page_url,
                                origin, result_status, validation, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          summary.runId,
          s.scenario.title,
          s.scenario.type,
          s.scenario.priority,
          s.scenario.pageUrl,
          s.scenario.origin,
          s.result.status,
          JSON.stringify(s.validation),
          reviewStatus,
        ],
      );
    }
  });
}
