---
id: TASK-034
parent_us: [US-018, US-019, US-021]
parent_req: REQ-010
sprint: SPRINT-004
status: planned
estimate: 1h
---

# TASK-034 — `ai-test auth detect | login` subcommands

## Goal
Two subcommands:
- `auth detect --url <URL> --output <recipe-path>`
- `auth login --recipe <path> --output-storage <storage-path>`

## Files
- `app/lib/cli/commands/auth.ts`
- `scripts/ai-test.ts` (register)

## llm_execution
target      : cloud
reason      : security boundary
complexity  : low
context_size: small
