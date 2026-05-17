---
id: TASK-018
parent_us: [US-011]
parent_req: REQ-007
sprint: SPRINT-002
status: planned
estimate: 3h
---

# TASK-018 — Runs index + run detail web routes

## Goal
- `app/lib/db/runs.ts`, `app/lib/db/scenarios.ts` — parameterised queries.
- `app/routes/runs._index.tsx` — list last 50 runs.
- `app/routes/runs.$runId.tsx` — KPI cards + scenarios table with filters.

## Files
- `app/lib/db/runs.ts`
- `app/lib/db/scenarios.ts`
- `app/routes/runs._index.tsx`
- `app/routes/runs.$runId.tsx`
- `app/components/runs/RunSummaryCard.tsx`
- `app/components/runs/ScenarioRow.tsx`

## Acceptance
- US-011 AC-1..AC-4.

## llm_execution
target      : cloud
reason      : UI + DB; needs requireUser auth glue
complexity  : medium
context_size: medium
