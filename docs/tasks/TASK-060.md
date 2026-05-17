---
id: TASK-060
parent_us: [US-041]
parent_req: REQ-017
sprint: SPRINT-006
status: planned
estimate: 3h
---

# TASK-060 — AI token budget + BudgetExceededError + partial summary

## Goal
- Provider adapters return `usage: { input, output }`.
- `chained provider` tracks cumulative tokens per role; raises
  `BudgetExceededError` before sending a call that would exceed budget.
- CLI `--budget <N>` overrides config.
- On halt, write partial RunSummary with `interrupted: true`.
- `ai-trace.jsonl` records `{ input, output, cumul }` per call.

## Files
- `app/lib/ai/provider.ts` (extend interface)
- `app/lib/ai/providers/{claude,codex,opencode-compatible,opencode,mock}.ts`
- `app/lib/ai/resolve.ts` (budget accounting)
- `app/lib/cli/commands/run.ts` (--budget)

## Acceptance
- US-041 AC-1..AC-5.

## llm_execution
target      : cloud
reason      : security + cost governance
complexity  : medium
context_size: medium
