---
id: TASK-031
parent_us: [US-018, US-019]
parent_req: REQ-010
sprint: SPRINT-004
status: planned
estimate: 1h
---

# TASK-031 — AuthRecipe schema + secret substitution

## Goal
Zod `AuthRecipe` per ADR-007; `loadAuthRecipe(path)` does
`${ENV_VAR}` substitution at load time. Missing env → `AuthConfigError`.

## Files
- `app/lib/validation/auth-recipe.ts`
- `app/lib/auth/recipe-loader.ts`
- `app/lib/auth/recipe-loader.test.ts`

## llm_execution
target      : cloud
reason      : security-sensitive (secret handling)
complexity  : low
context_size: small
