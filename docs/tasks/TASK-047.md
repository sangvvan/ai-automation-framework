---
id: TASK-047
parent_us: [US-030]
parent_req: REQ-014
sprint: SPRINT-005
status: planned
estimate: 3h
---

# TASK-047 — SPA wait strategies

## Goal
- Extend `wait_for` Action with optional
  `strategy: 'visible'|'network-idle'|'mutation-stable'|'route-change'`.
- Implement each strategy in `app/lib/runner/keywords/wait-for.ts`:
  - network-idle: `page.waitForLoadState('networkidle', { timeout })`
  - mutation-stable: page-eval MutationObserver with debounce
  - route-change: `page.waitForFunction(() => history.length > N)`
- Fixture HTML in tests/fixtures/sample-app/dynamic.html.

## Files
- `app/lib/runner/keywords/wait-for.ts` (extend)
- `app/lib/runner/keywords/strategies/{mutation-stable,route-change}.ts`
- `tests/fixtures/sample-app/dynamic.html`

## Acceptance
- US-030 AC-1..AC-5.

## llm_execution
target      : cloud
reason      : SPA timing nuances
complexity  : medium
context_size: small
