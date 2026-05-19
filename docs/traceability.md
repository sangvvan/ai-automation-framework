# Requirements Traceability Matrix

> Append-only. Each phase updates the rows it owns.

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
| REQ-009 | Web Crawler & SiteMap | 4 | implemented (SPRINT-004) |
| REQ-010 | Authenticated Test Flows | 2 | implemented (SPRINT-004) |
| REQ-011 | ISTQB Test Plan & Suite | 3 | implemented (SPRINT-005, suite UI partial) |
| REQ-012 | ISTQB Design Techniques | 2 | implemented (SPRINT-005) |
| REQ-013 | Non-Functional Quality Coverage | 4 | implemented (SPRINT-005 + SPRINT-006: multi-browser + locale + a11y/perf/security wired in runner) |
| REQ-014 | Stability — SPA waits, self-heal, screenshots, assertions | 4 | implemented (SPRINT-005 SPA waits + assertions; SPRINT-006 self-heal + verify_screenshot) |
| REQ-015 | CI/CD Interop — JUnit + PR comment | 2 | implemented (JUnit XML SPRINT-005; PR comment + CI extension SPRINT-006) |
| REQ-016 | Advanced interactions + test data | 2 | implemented (SPRINT-006: upload_file/drag_drop/type_keyboard/scroll_to + faker test-data) |
| REQ-017 | Defects, coverage, cost guardrails | 3 | implemented (SPRINT-006: defects table + UI + insertion; coverage tracker; token budget + BudgetExceededError) |

## Matrix (delta — Sprints 4/5/6 only)

| REQ | US | TASK | Sprint | Status |
|-----|-----|------|--------|--------|
| REQ-009 | US-016 | TASK-027, TASK-028, TASK-029, TASK-030 | SPRINT-004 | planned |
| REQ-009 | US-017 | TASK-028 | SPRINT-004 | planned |
| REQ-009 | US-020 | TASK-035, TASK-064 | SPRINT-004 | planned |
| REQ-009 | US-021 | TASK-030, TASK-034 | SPRINT-004 | planned |
| REQ-010 | US-018 | TASK-031, TASK-032, TASK-034 | SPRINT-004 | planned |
| REQ-010 | US-019 | TASK-031, TASK-033, TASK-034, TASK-064 | SPRINT-004 | planned |
| REQ-011 | US-022 | TASK-036, TASK-037, TASK-038 | SPRINT-005 | planned |
| REQ-011 | US-023 | TASK-038, TASK-039, TASK-040 | SPRINT-005 | planned |
| REQ-011 | US-031 | TASK-048 | SPRINT-005 | planned |
| REQ-012 | US-024 | TASK-041 | SPRINT-005 | planned |
| REQ-012 | US-025 | TASK-042 | SPRINT-005 | planned |
| REQ-013 | US-026 | TASK-043, TASK-061 | SPRINT-005 | planned |
| REQ-013 | US-027 | TASK-044 | SPRINT-005 | planned |
| REQ-013 | US-032 | TASK-049 | SPRINT-006 | planned |
| REQ-013 | US-040 | TASK-059 | SPRINT-006 | planned |
| REQ-014 | US-029 | TASK-046 | SPRINT-005 | planned |
| REQ-014 | US-030 | TASK-047 | SPRINT-005 | planned |
| REQ-014 | US-033 | TASK-050 | SPRINT-006 | planned |
| REQ-014 | US-034 | TASK-051, TASK-052 | SPRINT-006 | planned |
| REQ-015 | US-028 | TASK-045, TASK-063 | SPRINT-005 / 006 | planned |
| REQ-015 | US-036 | TASK-055, TASK-063 | SPRINT-006 | planned |
| REQ-016 | US-038 | TASK-057 | SPRINT-006 | planned |
| REQ-016 | US-039 | TASK-058 | SPRINT-006 | planned |
| REQ-017 | US-035 | TASK-053, TASK-054 | SPRINT-006 | planned |
| REQ-017 | US-037 | TASK-056 | SPRINT-006 | planned |
| REQ-017 | US-041 | TASK-060 | SPRINT-006 | planned |

## ADRs
- ADR-001..ADR-005 — accepted (PS-001 set)
- ADR-006 — Crawler topology, politeness, route-pattern dedupe
- ADR-007 — Auth recipe DSL + storageState lifecycle
- ADR-008 — TestPlan + TestSuite schemas
- ADR-009 — Non-functional validators (axe / vitals / security headers)
- ADR-010 — Self-healing locator strategy
- ADR-011 — Screenshot baseline storage and diffing

## Sprint 1-3 retained from PS-001 traceability (unchanged)
See git history or this file's prior versions on `main`. Rows for
REQ-001..REQ-008 / US-001..US-015 / TASK-001..TASK-026 remain valid.
