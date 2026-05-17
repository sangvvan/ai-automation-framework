---
id: TASK-046
parent_us: [US-029]
parent_req: REQ-014
sprint: SPRINT-005
status: planned
estimate: 3h
---

# TASK-046 — Extended ExpectedResult assertions

## Goal
- Add fields per REQ-014 §Extended assertions to `ExpectedResult`.
- Validator dispatches each field to a dedicated check function:
  url-not-contains, text-not-contains, visible/not-visible,
  attribute, child-count.
- Each check has accept + reject test against a fixture.

## Files
- `app/lib/validation/scenario.ts` (extend ExpectedResult)
- `app/lib/validator/checks/extended.ts`
- `app/lib/validator/checks/extended.test.ts`

## Acceptance
- US-029 AC-1..AC-4.

## llm_execution
target      : cloud
reason      : test oracles must be precise
complexity  : medium
context_size: small
