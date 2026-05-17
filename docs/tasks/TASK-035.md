---
id: TASK-035
parent_us: [US-020]
parent_req: REQ-009
sprint: SPRINT-004
status: planned
estimate: 3h
---

# TASK-035 — Multi-page run from SiteMap

## Goal
Extend `ai-test run` to accept `--site-map <crawl-id>` (mutually
exclusive with `--url`). Iterates SiteMap pages, runs the existing
analyse→generate→execute pipeline per page, aggregates scenarios into
the same RunSummary. Reuses storageState from the crawl's auth.

## Files
- `app/lib/cli/commands/run.ts` (extend)
- `app/lib/cli/orchestrate-sitemap.ts`

## Acceptance
- US-020 AC-1..AC-4.

## llm_execution
target      : cloud
reason      : pipeline orchestration
complexity  : medium
context_size: medium
