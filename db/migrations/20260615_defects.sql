-- TASK-053: defects table (REQ-017)
CREATE TABLE IF NOT EXISTS defects (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  scenario_id        text REFERENCES scenarios(id) ON DELETE SET NULL,
  summary            text NOT NULL,
  steps_to_reproduce jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_links     jsonb NOT NULL DEFAULT '[]'::jsonb,
  severity           text NOT NULL CHECK (severity IN ('low','med','high')) DEFAULT 'med',
  status             text NOT NULL CHECK (status IN ('open','triaged','fixed','wont-fix')) DEFAULT 'open',
  external_ref       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_defects_run_id ON defects(run_id);
CREATE INDEX IF NOT EXISTS idx_defects_status ON defects(status);
CREATE INDEX IF NOT EXISTS idx_defects_severity ON defects(severity);
