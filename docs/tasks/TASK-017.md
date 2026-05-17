---
id: TASK-017
parent_us: [US-010]
parent_req: REQ-008
sprint: SPRINT-002
status: planned
estimate: 3h
---

# TASK-017 — Auth: helpers, routes, session

## Goal
Implement bcrypt password hashing, signed session cookies, helpers
`requireUser(request, role?)`, `createUser`, `verifyCredentials`,
`createSession`, `destroySession`. Routes: `/auth/register`,
`/auth/login`, `/auth/logout`.

## Files
- `app/lib/auth/passwords.ts`
- `app/lib/auth/session.ts`
- `app/lib/auth/require-user.ts`
- `app/lib/db/users.ts`
- `app/lib/db/sessions.ts`
- `app/lib/validation/auth.ts`
- `app/routes/auth.login.tsx`
- `app/routes/auth.register.tsx`
- `app/routes/auth.logout.tsx`

## Acceptance
- US-010 AC-1..AC-5.

## llm_execution
target      : cloud
reason      : authentication and security-sensitive (CLAUDE.md hard rule)
complexity  : medium
context_size: medium
