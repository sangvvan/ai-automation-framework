---
id: TASK-059
parent_us: [US-040]
parent_req: REQ-013
sprint: SPRINT-006
status: planned
estimate: 2h
---

# TASK-059 — Locale switching

## Goal
- `--locales en,vi,ja` CLI flag.
- Runner loops scenarios per locale (sequential).
- Browser context spawns with `Accept-Language` header.
- Validator check `langAttribute` verifies `<html lang>` matches.
- Report renders per-locale grouping.

## Files
- `app/lib/cli/commands/run.ts` (flag)
- `app/lib/browser/launcher.ts` (Accept-Language)
- `app/lib/validator/checks/lang-attribute.ts`
- `app/lib/reporter/html.ts` (locale chips)

## Acceptance
- US-040 AC-1..AC-4.

## llm_execution
target      : cloud
reason      : orchestration + report
complexity  : medium
context_size: small
