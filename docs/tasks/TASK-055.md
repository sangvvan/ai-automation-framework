---
id: TASK-055
parent_us: [US-036]
parent_req: REQ-015
sprint: SPRINT-006
status: planned
estimate: 2h
---

# TASK-055 — GitHub PR comment adapter

## Goal
- Read `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_PR_NUMBER` from env.
- POST to `repos/{owner}/{repo}/issues/{pr}/comments`; find existing
  by hidden marker `<!-- ai-test:summary:{runId-prefix} -->` and PATCH
  if present.
- Body builder caps at 64 KB; truncates failure list.

## Files
- `app/lib/reporter/github-pr.ts`
- `app/lib/cli/commands/run.ts` (call after report)

## Acceptance
- US-036 AC-1..AC-5.

## llm_execution
target      : cloud
reason      : external API + secret handling
complexity  : medium
context_size: small
