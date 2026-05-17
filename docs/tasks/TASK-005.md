---
id: TASK-005
parent_us: [US-003]
parent_req: REQ-001
sprint: SPRINT-001
status: planned
estimate: 4h
---

# TASK-005 — Page Analyzer (`app/lib/analyzer/`)

## Goal
Implement `analyzePage({ url, viewport?, authState? }) => Promise<PageAnalysis>`.
Walks the accessibility snapshot + DOM via Playwright to build the
`PageAnalysis` shape from ADR-002.

## Files
- `app/lib/analyzer/analyze.ts`
- `app/lib/analyzer/extractors/` (forms, buttons, links, inputs, dialogs)
- `app/lib/analyzer/mask.ts` (mask sensitive fields per ADR-003)
- `app/lib/analyzer/analyze.test.ts` (integration: opens a local fixture HTML)

## Acceptance
- US-003 AC-1..AC-5.

## llm_execution
target      : cloud
reason      : DOM heuristics, accessibility-tree walking
complexity  : high
context_size: medium
