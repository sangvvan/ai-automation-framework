---
id: TASK-014
parent_us: [US-015]
parent_req: REQ-008
sprint: SPRINT-001
status: planned
estimate: 1h
---

# TASK-014 — Fixture web app for smoke testing

## Goal
Add a tiny static HTML app under `tests/fixtures/sample-app/` (login,
search) so the framework can run end-to-end without external network.
Served by Playwright's webServer config in tests.

## Files
- `tests/fixtures/sample-app/login.html`
- `tests/fixtures/sample-app/search.html`
- `tests/fixtures/sample-app/server.mjs` (tiny http-server)
- `tests/fixtures/test-cases/login.yaml`

## llm_execution
target      : opencode
reason      : static HTML and mock data
complexity  : low
context_size: small
