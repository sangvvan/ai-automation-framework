---
id: TASK-049
parent_us: [US-032]
parent_req: REQ-013
sprint: SPRINT-006
status: planned
estimate: 3h
---

# TASK-049 — Multi-browser matrix execution

## Goal
- Add `runner.browsers: ('chromium'|'firefox'|'webkit')[]` to config.
- Runner loops scenarios per browser; tag `ScenarioResult.browser`.
- HTML report renders per-scenario compatibility row.
- `suggestedDefect.summary` appends `(<browser> only)` when failure
  is single-browser.

## Files
- `app/lib/browser/launcher.ts` (accept browser type)
- `app/lib/runner/runner.ts` (loop)
- `app/lib/reporter/html.ts` (matrix row)

## Acceptance
- US-032 AC-1..AC-4.

## llm_execution
target      : cloud
reason      : runtime orchestration
complexity  : medium
context_size: small
