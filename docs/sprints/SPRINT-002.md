---
id: SPRINT-002
goal: AI scenario generation (explore mode) + Review web UI with auth
status: planned
length: 1 sprint
---

# SPRINT-002 — AI + Review UI

## Sprint goal
A tester can run `ai-test run --url <URL> --mode explore`, the AI proposes
scenarios persisted to Postgres, and a signed-in reviewer can approve /
reject in the web UI; a Test Lead can promote into regression.

## In scope (user stories)
- US-009 — AI scenario generation
- US-010 — Auth (register/login/logout)
- US-011 — Runs list + run detail
- US-012 — Approve scenario
- US-013 — Reject scenario with reason
- US-014 — Promote to regression (test-lead)

## Tasks (execution order)
1. TASK-015 — Migration: users, sessions, audit_log
2. TASK-016 — Migration: runs, scenarios
3. TASK-017 — Auth helpers + routes
4. TASK-020 — AI provider abstraction + adapters
5. TASK-021 — Test Design Agent
6. TASK-022 — CLI `--mode explore` wiring
7. TASK-018 — Runs index + detail
8. TASK-019 — Approve / Reject / Promote actions

## Exit criteria
- All ACs for SPRINT-002 stories pass.
- Vitest + Playwright e2e + axe a11y green.
- traceability.md updated.

## Out of scope
- Regression diff (SPRINT-003).
- Docker, CI, docs (SPRINT-003).
