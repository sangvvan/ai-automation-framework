---
id: TASK-057
parent_us: [US-038]
parent_req: REQ-016
sprint: SPRINT-006
status: planned
estimate: 2h
---

# TASK-057 — Faker-backed test data generator

## Goal
- `@faker-js/faker` lazy-loaded.
- `generateValueForField({ fieldName, fieldType, locale, seed })`
  with heuristic mapping.
- Hooked into step-mapper for AI-generated scenarios; YAML test cases
  unchanged.
- Anti-harvest check: never emit a value observed verbatim in
  PageAnalysis text.

## Files
- `app/lib/scenario/test-data-gen.ts`
- `app/lib/scenario/test-data-gen.test.ts`
- `app/lib/scenario/step-mapper.ts` (call when value missing)

## Acceptance
- US-038 AC-1..AC-5.

## llm_execution
target      : opencode
reason      : library wrapping + heuristics
complexity  : low
context_size: small
