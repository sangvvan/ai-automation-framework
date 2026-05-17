---
id: TASK-025
parent_us: [US-001..US-015]
parent_req: REQ-008
sprint: SPRINT-003
status: planned
estimate: 1h
---

# TASK-025 — CI workflow (.github/workflows/ci.yml)

## Goal
Per AGENTS.md DevOps role: three jobs (quality, unit, e2e) + gitleaks.
All gates green required for merge.

## Files
- `.github/workflows/ci.yml`

## llm_execution
target      : cloud
reason      : pipeline + secret-scan policy
complexity  : low
context_size: small
