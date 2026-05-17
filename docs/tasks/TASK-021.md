---
id: TASK-021
parent_us: [US-009]
parent_req: REQ-003
sprint: SPRINT-002
status: planned
estimate: 3h
---

# TASK-021 — Test Design Agent (scenario generator)

## Goal
Given a `PageAnalysis` and optional AC/business rules, produce a Zod-valid
`GeneratedScenario[]` covering positive / negative / required-field /
boundary / navigation categories. Cap by `maxScenarios`. Pass through the
Resolver to ensure every step references a real element.

## Files
- `app/lib/ai/agents/test-design.ts`
- `app/lib/ai/prompts/test-design.system.md`
- `app/lib/ai/prompts/test-design.user.ts`
- `app/lib/ai/agents/test-design.test.ts` (MockProvider)

## Acceptance
- US-009 AC-1..AC-6.

## llm_execution
target      : cloud
reason      : prompt engineering + grounding logic
complexity  : high
context_size: large
