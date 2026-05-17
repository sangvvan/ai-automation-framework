---
id: TASK-040
parent_us: [US-023]
parent_req: REQ-011
sprint: SPRINT-005
status: planned
estimate: 2h
---

# TASK-040 — Suite view in Review UI

## Goal
New route `/runs/:runId/suites/:suiteId` listing scenarios in a suite
with setup/teardown timings + regression-tag badge. Suite filter chip
on `/runs/:runId`.

## Files
- `app/routes/runs.$runId.suites.$suiteId.tsx`
- `app/components/runs/SuiteCard.tsx`

## llm_execution
target      : cloud
reason      : UI + DB
complexity  : medium
context_size: small
