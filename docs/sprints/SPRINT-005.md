---
id: SPRINT-005
goal: ISTQB compliance — TestPlan, TestSuite, design techniques, a11y, perf, JUnit, SPA stability
status: planned
length: 2 sprints (~3 weeks)
---

# SPRINT-005 — ISTQB Core

## Sprint goal
Every run produces an ISTQB-aligned Test Plan + Test Suite grouping,
scenarios are tagged by design technique, axe + Web Vitals + security
headers add non-functional checks, JUnit XML lands for legacy CI, and
SPA wait strategies + extended assertions reduce flakiness.

## In scope (user stories)
- US-022 — TestPlan artefact per run
- US-023 — Test Suite layer with hooks
- US-024 — Design-technique field on every scenario
- US-025 — Technique-driven generation
- US-026 — axe-core a11y audit
- US-027 — Web Vitals capture
- US-028 — JUnit XML reporter
- US-029 — Extended assertions
- US-030 — SPA wait strategies
- US-031 — Test level field

## Tasks (execution order)
1. TASK-036 — TestPlan Zod schema
2. TASK-038 — Migration: test_suites + scenarios.suite_id + runs.test_plan_path
3. TASK-039 — Suite assembler + repo + suite-scoped re-run
4. TASK-037 — TestPlan generator + HTML tab
5. TASK-040 — Suite view in Review UI
6. TASK-041 — Extend ScenarioType + designTechnique field
7. TASK-042 — Per-technique prompt addenda + CLI flag
8. TASK-043 — axe-core integration
9. TASK-044 — Web Vitals capture
10. TASK-061 — Security-header validator
11. TASK-046 — Extended ExpectedResult assertions
12. TASK-047 — SPA wait strategies
13. TASK-048 — testLevel field + flag + pill
14. TASK-045 — JUnit XML reporter
15. TASK-062 — Update docs

## Exit criteria
- All AC for stories pass.
- Vitest + Playwright e2e + axe a11y green.
- TestPlan JSON exists per run; HTML "Test Plan" tab renders.
- JUnit XML validates against the canonical XSD.
- traceability.md updated.

## Out of scope (deferred)
- Multi-browser matrix (Sprint 6).
- Self-healing, baselining, advanced keywords, defects, coverage map,
  faker, PR comments, token budget (Sprint 6).
