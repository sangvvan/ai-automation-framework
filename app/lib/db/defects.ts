import { db } from "./client";

export type DefectStatus = "open" | "triaged" | "fixed" | "wont-fix";
export type DefectSeverity = "low" | "med" | "high";

export interface DefectRow {
  id: string;
  run_id: string;
  scenario_id: string | null;
  summary: string;
  steps_to_reproduce: unknown;
  evidence_links: unknown;
  severity: DefectSeverity;
  status: DefectStatus;
  external_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsertDefectInput {
  runId: string;
  scenarioId?: string;
  summary: string;
  stepsToReproduce: string[];
  evidenceLinks: string[];
  severity: DefectSeverity;
}

export const defectsRepo = {
  async insert(input: InsertDefectInput): Promise<DefectRow | null> {
    return db.queryOne<DefectRow>(
      `INSERT INTO defects (run_id, scenario_id, summary, steps_to_reproduce,
                             evidence_links, severity)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, run_id, scenario_id, summary, steps_to_reproduce,
                 evidence_links, severity, status, external_ref,
                 created_at, updated_at`,
      [
        input.runId,
        input.scenarioId ?? null,
        input.summary,
        JSON.stringify(input.stepsToReproduce),
        JSON.stringify(input.evidenceLinks),
        input.severity,
      ],
    );
  },
  async listByRun(runId: string): Promise<DefectRow[]> {
    return db.query<DefectRow>(
      `SELECT id, run_id, scenario_id, summary, steps_to_reproduce,
              evidence_links, severity, status, external_ref,
              created_at, updated_at
         FROM defects WHERE run_id = $1 ORDER BY created_at DESC`,
      [runId],
    );
  },
  async updateStatus(id: string, status: DefectStatus): Promise<void> {
    await db.execute(
      `UPDATE defects SET status = $1, updated_at = now() WHERE id = $2`,
      [status, id],
    );
  },
  async setExternalRef(id: string, externalRef: string | null): Promise<void> {
    await db.execute(
      `UPDATE defects SET external_ref = $1, updated_at = now() WHERE id = $2`,
      [externalRef, id],
    );
  },
};
