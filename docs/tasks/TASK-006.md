---
id: TASK-006
parent_us: [US-003]
parent_req: REQ-001
sprint: SPRINT-001
status: planned
estimate: 1h
---

# TASK-006 — CLI subcommand `ai-test analyze`

## Goal
Wire `ai-test analyze --url <URL>` → `analyzePage` → writes
`reports/evidence/{run-id}/page-analysis.json` + `page.png`. Prints the
run id and the artifact paths to stdout.

## Files
- `app/lib/cli/commands/analyze.ts`
- `app/lib/cli/run-id.ts` (shared id generator)

## Acceptance
- US-003 AC-1, AC-4, AC-5.

## llm_execution
target      : cloud
reason      : orchestration with side-effects on filesystem
complexity  : low
context_size: small
