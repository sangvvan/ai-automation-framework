---
id: TASK-033
parent_us: [US-019]
parent_req: REQ-010
sprint: SPRINT-004
status: planned
estimate: 3h
---

# TASK-033 — Auth executor + storageState capture

## Goal
`executeAuth(recipe, page)` runs login, captures
`context.storageState()` to `reports/evidence/{run-id}/storage-state.json`
with `chmod 0600`. Detects mid-run expiry; one re-login allowed.

## Files
- `app/lib/auth/execute-auth.ts`
- `app/lib/auth/storage-state.ts`
- `app/lib/auth/execute-auth.test.ts`

## Acceptance
- US-019 AC-1..AC-5.

## llm_execution
target      : cloud
reason      : auth flow, security-sensitive (CLAUDE.md hard rule)
complexity  : medium
context_size: medium
