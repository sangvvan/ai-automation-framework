---
id: TASK-027
parent_us: [US-016]
parent_req: REQ-009
sprint: SPRINT-004
status: planned
estimate: 1h
---

# TASK-027 — SiteMap Zod schema

## Goal
Add `SiteMap`, `SiteMapPage`, `CrawlConfig`, `CrawlOutcome` schemas
matching ADR-006.

## Files
- `app/lib/validation/sitemap.ts`
- `app/lib/validation/sitemap.test.ts` (accept + reject)
- `app/lib/validation/index.ts` (re-export)

## llm_execution
target      : opencode
reason      : known-shape Zod schemas
complexity  : low
context_size: small
