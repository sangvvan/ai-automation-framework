---
id: SPRINT-004
goal: Universal-web — crawler + auth recipe so a single URL drives a full app
status: planned
length: 1.5 sprints (~2 weeks)
---

# SPRINT-004 — Universal-Web

## Sprint goal
A tester runs `ai-test crawl --url <X> [--auth-recipe ...]` and then
`ai-test run --site-map <id>` and gets a complete test execution
covering every reachable page of the app, including protected ones.

## In scope (user stories)
- US-016 — Crawl entry URL → SiteMap
- US-017 — Polite crawler (robots + rate limit)
- US-018 — Auto-detect login form
- US-019 — Execute auth recipe + storageState reuse
- US-020 — Multi-page run from SiteMap
- US-021 — CLI `crawl` + `auth` subcommands

## Tasks (execution order)
1. TASK-027 — SiteMap Zod schema
2. TASK-028 — Crawler engine (BFS, robots, rate-limit, route patterns)
3. TASK-029 — DB migration: crawls
4. TASK-030 — `ai-test crawl` CLI
5. TASK-031 — AuthRecipe schema + secret substitution
6. TASK-032 — Auto-detect login form
7. TASK-033 — Auth executor + storageState
8. TASK-034 — `ai-test auth` subcommands
9. TASK-064 — Migration: runs.auth_recipe_id / storage_state_path / crawl_id
10. TASK-035 — Multi-page run from SiteMap

## Exit criteria
- All AC for stories in scope pass.
- `npm run typecheck && npm run lint && npm run test` green.
- Smoke fixture run via the crawl pipeline works (fixture site has
  index + login + dashboard pages).
- `traceability.md` updated.

## Out of scope (deferred)
- ISTQB artefacts (Sprint 5).
- Multi-browser / non-functional checks (Sprint 5 / 6).
