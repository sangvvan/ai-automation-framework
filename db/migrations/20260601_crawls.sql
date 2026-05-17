-- TASK-029: crawls table (REQ-009)
CREATE TABLE IF NOT EXISTS crawls (
  id              text PRIMARY KEY,
  entry_url       text NOT NULL,
  started_at      timestamptz NOT NULL,
  finished_at     timestamptz NOT NULL,
  exit_reason     text NOT NULL CHECK (exit_reason IN
                    ('done','maxPagesReached','maxDepthReached',
                     'timeoutReached','aborted')),
  totals          jsonb NOT NULL,
  sitemap_path    text NOT NULL,
  ignore_robots   boolean NOT NULL DEFAULT false,
  include_subdomains boolean NOT NULL DEFAULT false,
  actor_id        uuid REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_crawls_started_at ON crawls(started_at DESC);
