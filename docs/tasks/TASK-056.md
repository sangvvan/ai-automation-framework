---
id: TASK-056
parent_us: [US-037]
parent_req: REQ-017
sprint: SPRINT-006
status: planned
estimate: 3h
---

# TASK-056 — Element coverage tracking + heatmap

## Goal
- Runner records each touched `PageElement.id` per scenario.
- Aggregate to `RunSummary.elementCoverage: { pageHash, touched[],
  total }`.
- Write `reports/coverage/{run-id}.json`.
- HTML report adds per-page "Coverage" panel with % + untested list.

## Files
- `app/lib/runner/coverage-tracker.ts`
- `app/lib/validation/result.ts` (add elementCoverage)
- `app/lib/reporter/coverage-json.ts`
- `app/lib/reporter/html.ts` (panel)

## Acceptance
- US-037 AC-1..AC-4.

## llm_execution
target      : cloud
reason      : runtime instrumentation
complexity  : medium
context_size: small
