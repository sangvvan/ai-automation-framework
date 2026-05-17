---
id: TASK-058
parent_us: [US-039]
parent_req: REQ-016
sprint: SPRINT-006
status: planned
estimate: 4h
---

# TASK-058 — Advanced element keywords

## Goal
- Implement `upload_file`, `drag_drop`, `switch_to_frame`,
  `switch_to_main`, `type_keyboard`, `scroll_to`.
- Extend resolver with `pierceShadow` flag.
- Extend Action discriminated-union schema accordingly.
- Fixture HTML pages: upload, sortable list, iframe, shadow-DOM.

## Files
- `app/lib/runner/keywords/{upload-file,drag-drop,switch-to-frame,type-keyboard,scroll-to}.ts`
- `app/lib/runner/resolver.ts` (pierceShadow)
- `app/lib/validation/scenario.ts` (Action additions)
- `tests/fixtures/sample-app/{upload,sortable,iframe,shadow}.html`

## Acceptance
- US-039 AC-1..AC-5.

## llm_execution
target      : cloud
reason      : Playwright API + DOM edge cases
complexity  : medium
context_size: medium
