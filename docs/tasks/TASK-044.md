---
id: TASK-044
parent_us: [US-027]
parent_req: REQ-013
sprint: SPRINT-005
status: planned
estimate: 3h
---

# TASK-044 — Web Vitals capture

## Goal
- Bundle `web-vitals` script locally (vendored or via dynamic
  `addScriptTag` with on-disk path).
- Inject on every `open_page` via `page.addInitScript`.
- Read `window.__aiTestVitals` after each scenario; populate
  `ScenarioResult.webVitals`.
- Validator emits perf check with thresholds from config.

## Files
- `app/lib/validator/checks/non-functional/web-vitals.ts`
- `app/lib/runner/inject-vitals.ts`
- `vendor/web-vitals.umd.js` (committed)

## Acceptance
- US-027 AC-1..AC-4.

## llm_execution
target      : cloud
reason      : page-eval scripting
complexity  : medium
context_size: small
