---
id: TASK-012
parent_us: [US-008]
parent_req: REQ-006
sprint: SPRINT-001
status: planned
estimate: 3h
---

# TASK-012 — HTML reporter (`app/lib/reporter/html.ts`)

## Goal
Render a self-contained HTML report (inline CSS, no CDN) from a
RunSummary. Sections: header, KPIs, scenario table with expandable
failures, regression-diff (if previous summary supplied), evidence
links.

## Files
- `app/lib/reporter/html.ts`
- `app/lib/reporter/templates/` (string templates)
- `app/lib/reporter/html.test.ts` (snapshot-style: validates structure)

## Acceptance
- US-008 AC-1..AC-4 (AC-4 wired in TASK-029).

## llm_execution
target      : cloud
reason      : templated HTML, masking, regression diff
complexity  : medium
context_size: medium
