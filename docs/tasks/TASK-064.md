---
id: TASK-064
parent_us: [US-016, US-019]
parent_req: REQ-009
sprint: SPRINT-004
status: planned
estimate: 1h
---

# TASK-064 — Migration: storage-state path on runs + auth recipe id

## Goal
`db/migrations/20260601_runs_auth.sql`:
- ALTER `runs` ADD COLUMN `auth_recipe_id text NULL`.
- ALTER `runs` ADD COLUMN `storage_state_path text NULL`.
- ALTER `runs` ADD COLUMN `crawl_id text REFERENCES crawls(id)`.

## llm_execution
target      : opencode
reason      : SQL from schema
complexity  : low
context_size: small
