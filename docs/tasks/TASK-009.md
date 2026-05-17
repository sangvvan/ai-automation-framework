---
id: TASK-009
parent_us: [US-005]
parent_req: REQ-004
sprint: SPRINT-001
status: planned
estimate: 3h
---

# TASK-009 — Scenario runner (`app/lib/runner/runner.ts`)

## Goal
Iterate scenario steps, call the right keyword, collect `StepResult`,
manage trace start/stop per scenario, capture screenshot on failure,
capture console messages, enforce `stepTimeoutMs`.

## Files
- `app/lib/runner/runner.ts`
- `app/lib/runner/context.ts` (RunnerContext type)
- `app/lib/runner/runner.test.ts`

## Acceptance
- US-005 AC-1, AC-2, AC-4, AC-5.

## llm_execution
target      : cloud
reason      : orchestration + error handling + Playwright resources
complexity  : medium
context_size: medium
