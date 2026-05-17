---
id: TASK-037
parent_us: [US-022, US-031]
parent_req: REQ-011
sprint: SPRINT-005
status: planned
estimate: 4h
---

# TASK-037 — TestPlan generator + persistence + HTML tab

## Goal
`generateTestPlan({ runId, siteMap, scenarios, suites, requirements,
config })` → deterministic Plan. AI used only for the optional
`approach` narrative (falls back to template). Persist JSON to
`reports/test-plans/{runId}.json`, set `runs.test_plan_path`. Extend
HTML reporter with a "Test Plan" tab.

## Files
- `app/lib/reporter/test-plan-generator.ts`
- `app/lib/reporter/templates/test-plan-tab.ts`
- `app/lib/reporter/html.ts` (tab wiring)

## Acceptance
- US-022 AC-1..AC-5; US-031 AC-2, AC-3.

## llm_execution
target      : cloud
reason      : narrative + assembly across multiple inputs
complexity  : medium
context_size: medium
