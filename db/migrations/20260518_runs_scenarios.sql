-- TASK-016: runs, scenarios

CREATE TABLE IF NOT EXISTS runs (
  id            text PRIMARY KEY,
  mode          text NOT NULL CHECK (mode IN ('testcase','explore')),
  app_url       text,
  started_at    timestamptz NOT NULL,
  finished_at   timestamptz NOT NULL,
  totals        jsonb NOT NULL,
  json_report   text NOT NULL,
  html_report   text NOT NULL,
  suite_tag     text
);

CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_suite_tag ON runs(suite_tag);

CREATE TABLE IF NOT EXISTS scenarios (
  id              text PRIMARY KEY,
  run_id          text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  title           text NOT NULL,
  type            text NOT NULL,
  priority        text NOT NULL,
  page_url        text NOT NULL,
  origin          text NOT NULL CHECK (origin IN
                    ('testcase-yaml','testcase-md','ai-generated','approved')),
  result_status   text NOT NULL,
  validation      jsonb NOT NULL,
  review_status   text NOT NULL DEFAULT 'pending_review'
                   CHECK (review_status IN ('pending_review','approved','rejected')),
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  reject_reason   text,
  in_regression   boolean NOT NULL DEFAULT false,
  spec_yaml       text
);

CREATE INDEX IF NOT EXISTS idx_scenarios_run_id ON scenarios(run_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_review_status ON scenarios(review_status);
