---
id: TASK-036
parent_us: [US-022]
parent_req: REQ-011
sprint: SPRINT-005
status: planned
estimate: 1h
---

# TASK-036 — TestPlan Zod schema

## Goal
Schemas in ADR-008 (TestPlan, Risk, TraceabilityRow). Accept + reject
tests.

## Files
- `app/lib/validation/test-plan.ts`
- `app/lib/validation/test-plan.test.ts`

## llm_execution
target      : opencode
reason      : known-shape schemas from ADR
complexity  : low
context_size: small
