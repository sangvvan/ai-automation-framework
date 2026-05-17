---
id: TASK-032
parent_us: [US-018]
parent_req: REQ-010
sprint: SPRINT-004
status: planned
estimate: 2h
---

# TASK-032 — Auto-detect login form

## Goal
`detectLoginForm(pageAnalysis)` → draft `AuthRecipe`. Heuristic:
one input that looks like username/email + one `type=password` input +
nearby submit button. Ambiguous → throw `AmbiguousLoginFormError`.

## Files
- `app/lib/auth/detect-login.ts`
- `app/lib/auth/detect-login.test.ts` (fixtures: classic, ambiguous,
  missing-password)

## llm_execution
target      : cloud
reason      : security-sensitive heuristics
complexity  : medium
context_size: small
