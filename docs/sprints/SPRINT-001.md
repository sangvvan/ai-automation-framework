---
id: SPRINT-001
goal: CLI + walking skeleton — testcase mode end-to-end with JSON + HTML report
status: active
start: 2026-05-17
length: 1 sprint
---

# SPRINT-001 — Walking skeleton

## Sprint goal
A tester can run `ai-test run --url <URL> --test-case <file> --mode testcase`
against the bundled fixture app and get a passing JSON + HTML report.

## In scope (user stories)
- US-001 — CLI installs and prints help
- US-002 — Config loader (YAML + env, Zod)
- US-003 — Page Analyzer
- US-004 — YAML/MD test-case parser + step mapper
- US-005 — Test Execution Engine
- US-006 — Result Validation
- US-007 — JSON report
- US-008 — HTML report (regression-diff deferred to SPRINT-003)
- US-015 — End-to-end smoke (testcase mode subset)

## Tasks (execution order)
1. TASK-001 — CLI scaffold
2. TASK-002 — Zod schemas
3. TASK-003 — Config loader
4. TASK-004 — Browser launcher
5. TASK-005 — Page Analyzer
6. TASK-006 — `ai-test analyze` subcommand
7. TASK-007 — YAML/MD parser + step mapper
8. TASK-008 — Keyword action library
9. TASK-009 — Scenario runner
10. TASK-010 — Validation Agent
11. TASK-011 — JSON reporter
12. TASK-012 — HTML reporter (without diff)
13. TASK-014 — Fixture sample app
14. TASK-013 — `ai-test run` testcase wiring

## Exit criteria
- All AC for stories in scope pass (except deferred ones).
- `npm run typecheck && npm run lint && npm run test` green.
- The fixture-app smoke E2E passes via `npm run test:e2e`.
- traceability.md updated.

## Out of scope (deferred)
- AI generation (SPRINT-002).
- Web review UI + auth (SPRINT-002).
- Regression diff (SPRINT-003).
- Docker + CI (SPRINT-003).
