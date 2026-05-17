---
id: TASK-011
parent_us: [US-007]
parent_req: REQ-006
sprint: SPRINT-001
status: planned
estimate: 1h
---

# TASK-011 — JSON reporter (`app/lib/reporter/json.ts`)

## Goal
Aggregate ScenarioResult + ValidationResult → `RunSummary` and write
`reports/json/{runId}.json`. Masks sensitive values.

## Files
- `app/lib/reporter/json.ts`
- `app/lib/reporter/mask.ts`
- `app/lib/reporter/json.test.ts`

## Acceptance
- US-007 AC-1..AC-4.

## llm_execution
target      : opencode
reason      : pure data assembly + serialization
complexity  : low
context_size: small
