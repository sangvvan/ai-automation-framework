---
id: TASK-030
parent_us: [US-016, US-021]
parent_req: REQ-009
sprint: SPRINT-004
status: planned
estimate: 2h
---

# TASK-030 — `ai-test crawl` CLI subcommand

## Goal
Wire `ai-test crawl --url <URL> [flags]` to call the crawler, persist
SiteMap to disk + DB. Print summary (pages visited, skipped, exit
reason, sitemap path).

## Files
- `app/lib/cli/commands/crawl.ts`
- `app/lib/db/crawls.ts`
- `scripts/ai-test.ts` (register subcommand)

## Acceptance
- US-016 AC-1; US-021 AC-1, AC-5.

## llm_execution
target      : cloud
reason      : orchestration + DB write
complexity  : medium
context_size: small
