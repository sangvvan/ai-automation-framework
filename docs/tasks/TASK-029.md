---
id: TASK-029
parent_us: [US-016, US-020]
parent_req: REQ-009
sprint: SPRINT-004
status: planned
estimate: 1h
---

# TASK-029 — DB migration: crawls

## Goal
`db/migrations/20260601_crawls.sql` — table `crawls` per ADR-006
(id, entry_url, started_at, finished_at, exit_reason, totals_json,
sitemap_path, ignore_robots boolean, actor_id).

## llm_execution
target      : opencode
reason      : SQL from defined schema
complexity  : low
context_size: small
