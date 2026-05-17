-- TASK-064: link runs to auth recipes, storage state, and source crawl.
ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS auth_recipe_id     text,
  ADD COLUMN IF NOT EXISTS storage_state_path text,
  ADD COLUMN IF NOT EXISTS crawl_id           text REFERENCES crawls(id);

CREATE INDEX IF NOT EXISTS idx_runs_crawl_id ON runs(crawl_id);
