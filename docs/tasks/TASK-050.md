---
id: TASK-050
parent_us: [US-033]
parent_req: REQ-014
sprint: SPRINT-006
status: planned
estimate: 4h
---

# TASK-050 — Self-healing locator engine

## Goal
- `app/lib/runner/self-heal.ts` per ADR-010: candidate scoring
  (Jaccard tokens + same-kind), max 3 trials.
- `selfHeal` opt-in flag in `runner` config.
- Persist `StepResult.healEvent` and surface "healed" badge in HTML.

## Files
- `app/lib/runner/self-heal.ts`
- `app/lib/runner/runner.ts` (call on LocatorNotFoundError)
- `app/lib/validation/result.ts` (add healEvent)

## Acceptance
- US-033 AC-1..AC-5.

## llm_execution
target      : cloud
reason      : fuzzy logic, must remain deterministic
complexity  : high
context_size: small
