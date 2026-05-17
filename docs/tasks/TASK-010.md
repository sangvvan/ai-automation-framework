---
id: TASK-010
parent_us: [US-006]
parent_req: REQ-005
sprint: SPRINT-001
status: planned
estimate: 2h
---

# TASK-010 — Validation Agent (`app/lib/validator/`)

## Goal
Implement `validate(scenarioResult, expected)` producing `ValidationResult`
with `checks[]`, `failureReason`, and `suggestedDefect` per ADR-002.

## Files
- `app/lib/validator/validate.ts`
- `app/lib/validator/checks/` (url, text, visible, console)
- `app/lib/validator/validate.test.ts`

## Acceptance
- US-006 AC-1..AC-4.

## llm_execution
target      : cloud
reason      : assertion logic is pivotal for correctness
complexity  : medium
context_size: small
