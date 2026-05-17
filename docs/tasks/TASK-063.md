---
id: TASK-063
parent_us: [US-022, US-028]
parent_req: REQ-015
sprint: SPRINT-006
status: planned
estimate: 1h
---

# TASK-063 — Extend CI workflow with JUnit upload + PR comment job

## Goal
- `.github/workflows/ci.yml`: upload `reports/junit/*.xml` as
  artefact + use `dorny/test-reporter` to render in PR.
- Add a job step that invokes the PR commenter on success/failure.

## Files
- `.github/workflows/ci.yml` (extend)

## llm_execution
target      : cloud
reason      : CI surface
complexity  : low
context_size: small
