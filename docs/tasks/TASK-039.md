---
id: TASK-039
parent_us: [US-023]
parent_req: REQ-011
sprint: SPRINT-005
status: planned
estimate: 3h
---

# TASK-039 — Suite assembler + repo + suite-scoped re-run

## Goal
- `app/lib/review/suite-assembler.ts`: group scenarios into suites
  (one per analysed page, fallback Ad-hoc). Slugify feature names.
- `app/lib/db/test-suites.ts`: queries.
- `ai-test run --suite-id <uuid>` and `--regression` flags.
- Setup/teardown hook invocation in runner.

## Acceptance
- US-023 AC-1..AC-5.

## llm_execution
target      : cloud
reason      : orchestration + new CLI flags
complexity  : medium
context_size: medium
