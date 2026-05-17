---
id: TASK-048
parent_us: [US-031]
parent_req: REQ-011
sprint: SPRINT-005
status: planned
estimate: 1h
---

# TASK-048 — testLevel field on RunSummary + CLI flag + header pill

## Goal
- Add `testLevel: TestLevel` on RunSummary (default `system`).
- `--test-level` CLI flag (validated against enum).
- HTML header shows it next to mode badge.
- TestPlan generator passes through `levels`.

## Files
- `app/lib/validation/result.ts` (extend)
- `app/lib/cli/commands/run.ts` (flag)
- `app/lib/reporter/html.ts` (pill)

## llm_execution
target      : opencode
reason      : straightforward field plumbing
complexity  : low
context_size: small
