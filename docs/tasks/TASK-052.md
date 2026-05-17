---
id: TASK-052
parent_us: [US-034]
parent_req: REQ-014
sprint: SPRINT-006
status: planned
estimate: 1h
---

# TASK-052 — `ai-test baselines accept` CLI

## Goal
`ai-test baselines accept --run-id <id> [--shot <name>]` walks the
evidence dir, replaces matching baselines, writes `audit_log` row
per replacement.

## Files
- `app/lib/cli/commands/baselines.ts`
- `scripts/ai-test.ts` (register)

## llm_execution
target      : cloud
reason      : filesystem + audit
complexity  : low
context_size: small
