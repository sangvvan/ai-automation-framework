---
id: TASK-001
parent_us: [US-001]
parent_req: REQ-008
sprint: SPRINT-001
status: planned
estimate: 2h
---

# TASK-001 — Scaffold `ai-test` CLI entrypoint + npm script

## Goal
Add `scripts/ai-test.ts` (tsx-runnable) and an `ai-test` npm script that
dispatches to subcommands and prints help. No subcommand logic yet —
only the dispatcher, help printer, and unknown-command path.

## Files
- `scripts/ai-test.ts` — new
- `app/lib/cli/commands.ts` — new (subcommand registry)
- `app/lib/cli/help.ts` — new
- `package.json` — add `ai-test` script (and `tsx` dev dep if missing)

## Acceptance
- AC-1, AC-2, AC-3 of US-001.

## llm_execution
target      : cloud
reason      : touches build scripts and process exit semantics
complexity  : low
context_size: small
