---
id: SPRINT-003
goal: Polish, NFR, DevOps, docs — ready for first internal release
status: planned
length: 1 sprint
---

# SPRINT-003 — Polish & Release

## Sprint goal
Regression diff lands, PII masking is enforced everywhere, the framework
runs in a container, CI is green, and the user-guide + architecture docs
are published.

## Tasks
1. TASK-023 — Regression-diff in HTML report (US-008 AC-4)
2. TASK-024 — Dockerfile + compose + .env.example
3. TASK-025 — GitHub Actions CI
4. TASK-026 — User guide + architecture docs

## Exit criteria
- Pre-flight check (per AGENTS.md DevOps role) all green.
- Image builds and starts; smoke run inside container produces a report.
- PR opened from `feature/system-test-framework-mvp` to `develop`.

## Out of scope
- Multi-tenancy, OAuth, visual baseline UI (post-MVP backlog).
