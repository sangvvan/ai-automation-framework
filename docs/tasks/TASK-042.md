---
id: TASK-042
parent_us: [US-025]
parent_req: REQ-012
sprint: SPRINT-005
status: planned
estimate: 4h
---

# TASK-042 — Per-technique prompt addenda + CLI --techniques flag

## Goal
- Move per-technique prompt fragments to
  `app/lib/ai/prompts/techniques/*.md`.
- Test Design Agent loops over requested techniques (default: all 8),
  appends the addendum, calls provider once per technique with the
  baseline prompt.
- `ai-test run --techniques boundary-value,decision-table` overrides
  default.
- "Technique coverage" panel in HTML report.

## Files
- `app/lib/ai/prompts/techniques/{eq,bva,dt,st,uc,pw,eg,ec}.md`
- `app/lib/ai/agents/test-design.ts` (extend)
- `app/lib/reporter/html.ts` (panel)

## Acceptance
- US-025 AC-1..AC-4.

## llm_execution
target      : cloud
reason      : prompt engineering + agent loop
complexity  : medium
context_size: medium
