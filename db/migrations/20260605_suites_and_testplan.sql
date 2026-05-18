-- TASK-038: test_suites + scenarios.suite_id + scenarios.design_technique
-- + runs.test_plan_path + runs.test_level

CREATE TABLE IF NOT EXISTS test_suites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  name            text NOT NULL,
  feature_slug    text NOT NULL,
  preconditions   text,
  setup_hook      text,
  teardown_hook   text,
  regression_tag  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_test_suites_run_id ON test_suites(run_id);
CREATE INDEX IF NOT EXISTS idx_test_suites_regression ON test_suites(regression_tag);

ALTER TABLE scenarios
  ADD COLUMN IF NOT EXISTS suite_id          uuid REFERENCES test_suites(id),
  ADD COLUMN IF NOT EXISTS design_technique  text NOT NULL DEFAULT 'error-guessing';
CREATE INDEX IF NOT EXISTS idx_scenarios_suite_id ON scenarios(suite_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_design_technique ON scenarios(design_technique);

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS test_plan_path text,
  ADD COLUMN IF NOT EXISTS test_level     text NOT NULL DEFAULT 'system'
                          CHECK (test_level IN ('unit','component','integration','system','acceptance'));
