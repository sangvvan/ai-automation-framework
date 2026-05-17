---
id: TASK-008
parent_us: [US-005]
parent_req: REQ-004
sprint: SPRINT-001
status: planned
estimate: 4h
---

# TASK-008 — Keyword action library (`app/lib/runner/keywords/`)

## Goal
Implement keywords per ADR-005: `open_page`, `click`, `fill`, `select`,
`verify_text`, `verify_url`, `wait_for`. Each is one file. All resolve
locators through the central resolver (`role → label → text → testId`).

## Files
- `app/lib/runner/resolver.ts` (locator resolver)
- `app/lib/runner/keywords/open-page.ts`
- `app/lib/runner/keywords/click.ts`
- `app/lib/runner/keywords/fill.ts`
- `app/lib/runner/keywords/select.ts`
- `app/lib/runner/keywords/verify-text.ts`
- `app/lib/runner/keywords/verify-url.ts`
- `app/lib/runner/keywords/wait-for.ts`
- `app/lib/runner/keywords/index.ts` (registry)
- `app/lib/runner/keywords.test.ts` (integration with fixture page)

## Acceptance
- US-005 AC-3 (banned `page.locator`/`page.$` outside keywords).
- All keywords return a typed `StepResult`.

## llm_execution
target      : cloud
reason      : Playwright integration + locator strategy
complexity  : medium
context_size: medium
