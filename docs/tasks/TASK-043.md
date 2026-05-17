---
id: TASK-043
parent_us: [US-026]
parent_req: REQ-013
sprint: SPRINT-005
status: planned
estimate: 3h
---

# TASK-043 — Wire @axe-core/playwright into runner

## Goal
- Implement `PostScenarioCheck` interface per ADR-009.
- `app/lib/validator/checks/non-functional/a11y.ts`: `injectAxe` +
  `getViolations`. Map impact → WCAG level. Convert violations into
  `ValidationCheck[]` with `category: 'a11y'`.
- Configurable severity gate `report.a11y.failOn`.

## Files
- `app/lib/validator/checks/non-functional/a11y.ts`
- `app/lib/validator/checks/non-functional/index.ts`
- `app/lib/validation/result.ts` (add `accessibilityViolations` +
  `category` on ValidationCheck)

## Acceptance
- US-026 AC-1..AC-5.

## llm_execution
target      : cloud
reason      : new validation surface + Playwright integration
complexity  : medium
context_size: small
