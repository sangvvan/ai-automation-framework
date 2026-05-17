---
id: TASK-038
parent_us: [US-022, US-023]
parent_req: REQ-011
sprint: SPRINT-005
status: planned
estimate: 1h
---

# TASK-038 — Migration: test_suites + scenarios.suite_id + runs.test_plan_path

## Goal
`db/migrations/20260605_suites_and_testplan.sql`:
- `test_suites` table per ADR-008
- ALTER scenarios ADD COLUMN suite_id, regression_tag
- ALTER runs ADD COLUMN test_plan_path, test_level

## llm_execution
target      : opencode
reason      : SQL from defined schema
complexity  : low
context_size: small
