---
id: TASK-028
parent_us: [US-016, US-017]
parent_req: REQ-009
sprint: SPRINT-004
status: planned
estimate: 6h
---

# TASK-028 — Crawler engine

## Goal
Implement BFS crawler per ADR-006: URL normalization, route-pattern
collapse, robots.txt parser, per-host token-bucket throttle, frontier
+ seen set, deterministic exit reasons. One in-process worker pool
reusing a single Playwright BrowserContext.

## Files
- `app/lib/crawler/normalize.ts`
- `app/lib/crawler/robots.ts` (tiny parser)
- `app/lib/crawler/rate-limiter.ts` (token bucket; injectable clock)
- `app/lib/crawler/route-pattern.ts`
- `app/lib/crawler/discover.ts` (orchestrator)
- `app/lib/crawler/*.test.ts` for each

## Acceptance
- US-016 AC-1..AC-4; US-017 AC-1..AC-4.

## llm_execution
target      : cloud
reason      : algorithmic + Playwright integration
complexity  : high
context_size: medium
