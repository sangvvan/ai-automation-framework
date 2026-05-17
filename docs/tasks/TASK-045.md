---
id: TASK-045
parent_us: [US-028]
parent_req: REQ-015
sprint: SPRINT-005
status: planned
estimate: 2h
---

# TASK-045 — JUnit XML reporter

## Goal
- `writeJunitReport(summary, { reportsDir, suites })` writes
  `reports/junit/{runId}.xml`.
- Schema: `<testsuites>` → `<testsuite>` per TestSuite → `<testcase>`
  per scenario, `<failure>`/`<skipped>` as needed, `<system-out>` with
  evidence paths.
- Validate against the canonical JUnit XSD in tests.

## Files
- `app/lib/reporter/junit.ts`
- `app/lib/reporter/junit.test.ts`

## Acceptance
- US-028 AC-1..AC-5.

## llm_execution
target      : opencode
reason      : straightforward serialisation
complexity  : low
context_size: small
