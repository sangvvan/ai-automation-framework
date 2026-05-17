---
id: TASK-002
parent_us: [US-002, US-003, US-004, US-005, US-006, US-007]
parent_req: REQ-008
sprint: SPRINT-001
status: planned
estimate: 3h
---

# TASK-002 — Canonical Zod schemas in `app/lib/validation/`

## Goal
Implement every schema from ADR-002: `Locator`, `PageElement`,
`PageAnalysis`, `Action`, `ScenarioStep`, `ExpectedResult`,
`ExecutableScenario`, `StepResult`, `ScenarioResult`, `ValidationResult`,
`RunSummary`. Export typed inference (`type X = z.infer<typeof X>`).

## Files
- `app/lib/validation/locator.ts`
- `app/lib/validation/page.ts`
- `app/lib/validation/scenario.ts`
- `app/lib/validation/result.ts`
- `app/lib/validation/index.ts`
- `app/lib/validation/*.test.ts` (1 accept + 1 reject per schema)

## Acceptance
- Schemas match ADR-002 exactly.
- Each has accept + reject Vitest test.

## llm_execution
target      : opencode
reason      : known-shape Zod schemas from ADR — low complexity
complexity  : low
context_size: medium
