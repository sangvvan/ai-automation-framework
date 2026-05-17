---
id: TASK-019
parent_us: [US-012, US-013, US-014]
parent_req: REQ-007
sprint: SPRINT-002
status: planned
estimate: 4h
---

# TASK-019 — Approve / Reject / Promote actions + audit log

## Goal
- POST `/runs/:runId/scenarios/:scenarioId/approve` (writes YAML to
  `tests/approved/...`).
- POST `/runs/:runId/scenarios/:scenarioId/reject` (reason ≥10).
- POST `/runs/:runId/scenarios/:scenarioId/promote` (role=test-lead;
  writes YAML to `tests/regression/...`).
- All inserts an `audit_log` row.

## Files
- `app/lib/db/audit-log.ts`
- `app/lib/review/promotion.ts` (yaml writer)
- `app/routes/runs.$runId.scenarios.$scenarioId.approve.tsx`
- `app/routes/runs.$runId.scenarios.$scenarioId.reject.tsx`
- `app/routes/runs.$runId.scenarios.$scenarioId.promote.tsx`

## Acceptance
- US-012 AC-1..AC-4. US-013 AC-1..AC-4. US-014 AC-1..AC-4.

## llm_execution
target      : cloud
reason      : auth + role gates + filesystem + audit
complexity  : medium
context_size: medium
