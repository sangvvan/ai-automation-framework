---
id: TASK-041
parent_us: [US-024]
parent_req: REQ-012
sprint: SPRINT-005
status: planned
estimate: 1h
---

# TASK-041 — Extend ScenarioType enum + designTechnique field

## Goal
- Add new enum `DesignTechnique` (equivalence-partition, boundary-value,
  decision-table, state-transition, use-case, pairwise, error-guessing,
  exploratory-charter).
- Add non-optional `designTechnique` field on `ExecutableScenario`
  (default: `error-guessing` for parsed YAML / Markdown without it).
- Update YAML/MD parser to honour optional `design_technique` key.

## Files
- `app/lib/validation/scenario.ts` (extend)
- `app/lib/scenario/parse.ts` (read key)

## llm_execution
target      : cloud
reason      : schema migration with backwards-compat
complexity  : low
context_size: small
