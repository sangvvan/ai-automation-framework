---
id: TASK-054
parent_us: [US-035]
parent_req: REQ-017
sprint: SPRINT-006
status: planned
estimate: 3h
---

# TASK-054 — Defect repo + insertion + Review UI

## Goal
- `app/lib/db/defects.ts` (CRUD).
- Validator hooks: insert a defects row whenever
  `suggestedDefect` is non-null.
- Route `/runs/$runId/defects.tsx` listing with status filter, copy
  button, external_ref input.
- Status transitions write audit_log.

## Files
- `app/lib/db/defects.ts`
- `app/lib/validator/validate.ts` (call defectsRepo.insert)
- `app/routes/runs.$runId.defects.tsx`
- `app/routes/runs.$runId.defects.$defectId.update.tsx`

## Acceptance
- US-035 AC-1..AC-5.

## llm_execution
target      : cloud
reason      : DB + UI + audit
complexity  : medium
context_size: medium
