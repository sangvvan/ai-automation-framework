---
id: SPRINT-006
goal: Polish + NFR depth — multi-browser, self-heal, screenshots, defects, coverage, faker, PR comment, budget
status: planned
length: 2 sprints (~2.5 weeks)
---

# SPRINT-006 — Polish & Operations

## Sprint goal
Cross-browser execution, self-healing locators, screenshot baselining,
persistent defects in the Review UI, GitHub PR comment integration,
element coverage heatmap, deterministic synthetic test data, advanced
element keywords, locale switching, and AI token-budget guardrails.

## In scope (user stories)
- US-032 — Multi-browser matrix
- US-033 — Self-healing locators
- US-034 — Screenshot diff baselining
- US-035 — Defects persistence + UI
- US-036 — GitHub PR comment
- US-037 — Element coverage heatmap
- US-038 — Faker-backed test data
- US-039 — Advanced element keywords
- US-040 — Locale switching
- US-041 — Token budget guardrail

## Tasks (execution order)
1. TASK-049 — Multi-browser matrix execution
2. TASK-050 — Self-healing locator engine
3. TASK-051 — verify_screenshot + baseline store
4. TASK-052 — `ai-test baselines accept` CLI
5. TASK-053 — Migration: defects
6. TASK-054 — Defect repo + insertion + Review UI
7. TASK-055 — GitHub PR comment adapter
8. TASK-063 — CI workflow extend (JUnit upload + PR commenter)
9. TASK-056 — Element coverage tracking + heatmap
10. TASK-057 — Faker test data generator
11. TASK-058 — Advanced element keywords (upload, drag, iframe, shadow, keys)
12. TASK-059 — Locale switching
13. TASK-060 — Token budget + BudgetExceededError

## Exit criteria
- All AC pass.
- CI green; PR comment posts when env present.
- Sample run on a production-shaped fixture exercises crawl + auth +
  multi-page + multi-browser + a11y + perf in under ~5 minutes.
- traceability.md updated.

## Out of scope (post-MVP-2 backlog)
- SSO / OAuth flows.
- True load / soak performance testing.
- Real-device cloud grids (BrowserStack, Sauce).
- Auto-create external Jira / GitHub issues from defects.
- Visual baseline-management UI (CLI accept only in this enhancement).
