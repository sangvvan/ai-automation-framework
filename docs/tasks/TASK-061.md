---
id: TASK-061
parent_us: [US-026]
parent_req: REQ-013
sprint: SPRINT-005
status: planned
estimate: 2h
---

# TASK-061 — Security-header validator

## Goal
- `app/lib/validator/checks/non-functional/security-headers.ts` per
  ADR-009: capture response.headers per navigation, validate CSP,
  HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  Set-Cookie flags.
- Configurable severity per missing header.

## Files
- `app/lib/validator/checks/non-functional/security-headers.ts`
- `app/lib/validator/checks/non-functional/security-headers.test.ts`

## llm_execution
target      : cloud
reason      : security-sensitive checks
complexity  : medium
context_size: small
