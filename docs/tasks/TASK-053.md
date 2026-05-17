---
id: TASK-053
parent_us: [US-035]
parent_req: REQ-017
sprint: SPRINT-006
status: planned
estimate: 1h
---

# TASK-053 — Migration: defects + suggestion linkage

## Goal
`db/migrations/20260615_defects.sql`:
- table `defects` (id, run_id, scenario_id, summary, steps_to_reproduce
  jsonb, evidence_links jsonb, severity, status, external_ref,
  created_at, updated_at).
- indexes (run_id, status, severity).

## llm_execution
target      : opencode
reason      : SQL from schema
complexity  : low
context_size: small
