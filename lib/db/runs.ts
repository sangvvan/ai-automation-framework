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
  /** Most recent run with the same suite tag that started before `current`. */
  async findPreviousBySuiteTag(
    current: RunRow,
  ): Promise<RunRow | null> {
    if (!current.suite_tag) return null;
    return db.queryOne<RunRow>(
      `SELECT id, mode, app_url, started_at, finished_at, totals,
              json_report, html_report, suite_tag
         FROM runs
         WHERE suite_tag = $1 AND started_at < $2
         ORDER BY started_at DESC LIMIT 1`,
      [current.suite_tag, current.started_at],
    );
  },
};

/**
 * Bare scenario id (without the run-id prefix used as the DB primary key).
 * Scenarios are stored as `${runId}::${scenarioId}` so that the same
 * generated id can recur across runs without colliding on PRIMARY KEY.
 */
export function bareScenarioId(row: ScenarioRow): string {
  const sep = "::";
  const idx = row.id.indexOf(sep);
  return idx >= 0 ? row.id.slice(idx + sep.length) : row.id;
}

export interface RegressionDiff {
  newFailures: { id: string; title: string }[];
  newlyPassing: { id: string; title: string }[];
  carriedFailures: { id: string; title: string }[];
}

export function computeRegressionDiff(
  current: ScenarioRow[],
  previous: ScenarioRow[],
): RegressionDiff {
  const prev = new Map(previous.map((s) => [bareScenarioId(s), s]));
  const newFailures: RegressionDiff["newFailures"] = [];
  const newlyPassing: RegressionDiff["newlyPassing"] = [];
  const carriedFailures: RegressionDiff["carriedFailures"] = [];
  for (const s of current) {
    const base = bareScenarioId(s);
    const prior = prev.get(base);
    if (s.result_status === "failed" && prior?.result_status !== "failed") {
      newFailures.push({ id: base, title: s.title });
    } else if (s.result_status === "passed" && prior?.result_status === "failed") {
      newlyPassing.push({ id: base, title: s.title });
    } else if (s.result_status === "failed" && prior?.result_status === "failed") {
      carriedFailures.push({ id: base, title: s.title });
    }
  }
  return { newFailures, newlyPassing, carriedFailures };
}

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
