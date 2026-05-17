---
id: TASK-023
parent_us: [US-008]
parent_req: REQ-006
sprint: SPRINT-003
status: planned
estimate: 2h
---

# TASK-023 — Regression-diff in HTML report

## Goal
On report render, find the prior `RunSummary` with matching `suite_tag`
and inject a "Regression diff" section listing new failures and
newly-passing scenarios.

## Files
- `app/lib/reporter/regression-diff.ts`
- `app/lib/reporter/html.ts` (extended)
- `app/lib/reporter/regression-diff.test.ts`

## Acceptance
- US-008 AC-4.

## llm_execution
target      : cloud
reason      : non-trivial diff algorithm
complexity  : medium
context_size: small
