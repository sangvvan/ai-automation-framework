---
id: TASK-007
parent_us: [US-004]
parent_req: REQ-002
sprint: SPRINT-001
status: planned
estimate: 3h
---

# TASK-007 — YAML + Markdown test-case parser and step mapper

## Goal
Implement `parseTestCaseFile(path)` supporting `.yaml`/`.yml` and `.md`.
Validates against the PS §6.2 schema and runs the step mapper against an
optional PageAnalysis to produce `ExecutableScenario`.

## Files
- `app/lib/scenario/parse-yaml.ts`
- `app/lib/scenario/parse-markdown.ts`
- `app/lib/scenario/step-mapper.ts`
- `app/lib/scenario/parse.test.ts` (fixtures: happy, missing-steps,
  unmappable step)

## Acceptance
- US-004 AC-1..AC-4.

## llm_execution
target      : cloud
reason      : NL→keyword mapping is judgement-heavy
complexity  : medium
context_size: medium
