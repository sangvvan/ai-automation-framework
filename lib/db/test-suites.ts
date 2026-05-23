import { db } from "./client";
import type { PoolClient } from "pg";

export interface TestSuiteRow {
  id: string;
  run_id: string;
  name: string;
  feature_slug: string;
  preconditions: string | null;
  setup_hook: string | null;
  teardown_hook: string | null;
  regression_tag: string | null;
  created_at: string;
}

export interface CreateSuiteInput {
  runId: string;
  name: string;
  featureSlug: string;
  preconditions?: string;
  setupHook?: string;
  teardownHook?: string;
  regressionTag?: string;
}

export const testSuitesRepo = {
  async create(input: CreateSuiteInput, client?: PoolClient): Promise<TestSuiteRow> {
    const sql = `
      INSERT INTO test_suites
        (run_id, name, feature_slug, preconditions, setup_hook, teardown_hook, regression_tag)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id, run_id, name, feature_slug, preconditions, setup_hook,
                teardown_hook, regression_tag, created_at`;
    const params = [
      input.runId,
      input.name,
      input.featureSlug,
      input.preconditions ?? null,
      input.setupHook ?? null,
      input.teardownHook ?? null,
      input.regressionTag ?? null,
    ];
    let row: TestSuiteRow | undefined;
    if (client) {
      const result = await client.query<TestSuiteRow>(sql, params);
      row = result.rows[0];
    } else {
      const rows = await db.query<TestSuiteRow>(sql, params);
      row = rows[0];
    }
    if (!row) throw new Error("Failed to insert test suite");
    return row;
  },

  async listByRun(runId: string): Promise<TestSuiteRow[]> {
    return db.query<TestSuiteRow>(
      `SELECT id, run_id, name, feature_slug, preconditions, setup_hook,
              teardown_hook, regression_tag, created_at
         FROM test_suites WHERE run_id = $1 ORDER BY name`,
      [runId],
    );
  },

  async findById(id: string): Promise<TestSuiteRow | null> {
    return db.queryOne<TestSuiteRow>(
      `SELECT id, run_id, name, feature_slug, preconditions, setup_hook,
              teardown_hook, regression_tag, created_at
         FROM test_suites WHERE id = $1`,
      [id],
    );
  },
};
