---
id: TASK-022
parent_us: [US-015]
parent_req: REQ-008
sprint: SPRINT-002
status: planned
estimate: 2h
---

# TASK-022 — CLI wiring for `--mode explore`

## Goal
Wire explore mode: analyze page → Test Design Agent → runner → validator
→ reporter. Persist generated scenarios as `pending_review` in DB.

## Files
- `app/lib/cli/commands/run.ts` (extended)
- `app/lib/cli/persist-run.ts`

## Acceptance
- US-015 AC-1..AC-3 in `--mode explore`.

## llm_execution
target      : cloud
reason      : pipeline orchestration + DB persistence
complexity  : medium
context_size: medium
