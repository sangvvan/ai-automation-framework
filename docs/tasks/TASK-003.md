---
id: TASK-003
parent_us: [US-002]
parent_req: REQ-008
sprint: SPRINT-001
status: planned
estimate: 2h
---

# TASK-003 — Config loader (`app/lib/config.ts` + `configs/*.yaml`)

## Goal
- Sole reader of `process.env`. Exports `loadConfig()` returning a Zod-typed
  `FrameworkConfig`.
- Loads `configs/framework.config.yaml`, `configs/test-env.yaml`,
  `configs/ai-provider.yaml`, deep-merges, applies env overrides
  (`AI_TEST_*`), validates.

## Files
- `app/lib/config.ts`
- `configs/framework.config.yaml` (commit defaults)
- `configs/test-env.yaml`
- `configs/ai-provider.yaml`
- `app/lib/config.test.ts`

## Acceptance
- US-002 AC-1..AC-4.

## llm_execution
target      : cloud
reason      : security boundary (only file reading process.env)
complexity  : medium
context_size: small
