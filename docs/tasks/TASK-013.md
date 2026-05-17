---
id: TASK-013
parent_us: [US-015, US-001]
parent_req: REQ-008
sprint: SPRINT-001
status: planned
estimate: 2h
---

# TASK-013 — CLI subcommand `ai-test run` (testcase mode wiring)

## Goal
Wire the end-to-end testcase path:
  parse test-case → analyze page → run scenarios → validate → JSON + HTML.
Print summary + report paths. Non-zero exit on any failed scenario.

## Files
- `app/lib/cli/commands/run.ts`
- `app/lib/cli/orchestrate.ts`

## Acceptance
- US-015 AC-1..AC-2 for `--mode testcase`.

## llm_execution
target      : cloud
reason      : full pipeline orchestration
complexity  : medium
context_size: medium
