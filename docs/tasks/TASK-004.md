---
id: TASK-004
parent_us: [US-003]
parent_req: REQ-001
sprint: SPRINT-001
status: planned
estimate: 2h
---

# TASK-004 — Browser launcher (`app/lib/browser/launcher.ts`)

## Goal
Boot a Chromium browser context with config-driven viewport + tracing.
Returns `{ browser, context, page, traceStart, traceStop, close }`.

## Files
- `app/lib/browser/launcher.ts`
- `app/lib/browser/storage-state.ts` (stub; persisted login state)
- `app/lib/browser/launcher.test.ts` (uses Playwright real chromium —
  marked as integration, skipped when no browsers installed)

## Acceptance
- Page opens within configured timeout; tracing starts/stops; cleanup runs
  even on exception.

## llm_execution
target      : cloud
reason      : Playwright integration, non-trivial async lifecycle
complexity  : medium
context_size: small
