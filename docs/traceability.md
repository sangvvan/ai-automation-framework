# Requirements Traceability Matrix

> Updated after every phase. **Append-only**; never delete rows.

## Overview

| REQ | Title | US count | Status |
|-----|-------|---------:|--------|
| REQ-001 | Page Analyzer | 1 | implemented |
| REQ-002 | Test Case Input Mode | 1 | implemented |
| REQ-003 | AI Scenario Generation | 1 | implemented |
| REQ-004 | Test Execution Engine | 1 | implemented |
| REQ-005 | Result Validation | 1 | implemented |
| REQ-006 | Reporting | 2 | implemented |
| REQ-007 | Human Review & Approval | 4 | implemented |
| REQ-008 | CLI, Config, Auth | 4 | implemented |

## Matrix

| REQ | US | TASK | Sprint | Status |
|-----|-----|------|--------|--------|
| REQ-008 | US-001 | TASK-001 | SPRINT-001 | done |
| REQ-008 | US-002 | TASK-002, TASK-003 | SPRINT-001 | done |
| REQ-001 | US-003 | TASK-004, TASK-005, TASK-006 | SPRINT-001 | done |
| REQ-002 | US-004 | TASK-007 | SPRINT-001 | done |
| REQ-004 | US-005 | TASK-008, TASK-009 | SPRINT-001 | done |
| REQ-005 | US-006 | TASK-010 | SPRINT-001 | done |
| REQ-006 | US-007 | TASK-011 | SPRINT-001 | done |
| REQ-006 | US-008 | TASK-012, TASK-023 | SPRINT-001 / 003 | done |
| REQ-008 | US-015 | TASK-013, TASK-014, TASK-022 | SPRINT-001 / 002 | done |
| REQ-003 | US-009 | TASK-020, TASK-021 | SPRINT-002 | done |
| REQ-008 | US-010 | TASK-015, TASK-017 | SPRINT-002 | done |
| REQ-007 | US-011 | TASK-016, TASK-018 | SPRINT-002 | done |
| REQ-007 | US-012 | TASK-019 | SPRINT-002 | done |
| REQ-007 | US-013 | TASK-019 | SPRINT-002 | done |
| REQ-007 | US-014 | TASK-019 | SPRINT-002 | done |
| —       | —      | TASK-024 (Docker) | SPRINT-003 | done |
| —       | —      | TASK-025 (CI)     | SPRINT-003 | done |
| —       | —      | TASK-026 (docs)   | SPRINT-003 | done |

## ADRs
- ADR-001 — Runtime, orchestration, and project topology (accepted)
- ADR-002 — Canonical Zod schemas (accepted)
- ADR-003 — AI provider abstraction (accepted)
- ADR-004 — PostgreSQL schema (accepted)
- ADR-005 — Locator strategy + keyword actions (accepted)

## Test gates (last green)
- Vitest: **41 passed / 12 files**
- TypeScript: **clean** (`tsc --noEmit`)
- ESLint: **clean**
- Playwright smoke: deferred to CI (Playwright browser install blocked
  from the agent's network policy; locally run via the `e2e` CI job or
  the fixture-app instructions in `docs/user-guide.md`).

## Known follow-ups (post-MVP backlog)
- TASK-023 polish — surface the regression-diff in the web UI run page,
  not only in the HTML report.
- Multi-page user-journey generation (REQ-003 extension).
- Self-healing locators (REQ-004 extension).
- Visual baseline manager (REQ-006 extension).
- SSO / OAuth (REQ-008 extension).
