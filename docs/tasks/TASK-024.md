---
id: TASK-024
parent_us: [US-015]
parent_req: REQ-008
sprint: SPRINT-003
status: planned
estimate: 1h
---

# TASK-024 — Dockerfile, compose, .env.example

## Goal
Multi-stage Dockerfile, docker-compose with postgres, .env.example with
every var consumed by `app/lib/config.ts`.

## Files
- `Dockerfile` (refine existing)
- `docker-compose.yml` (refine existing)
- `.env.example` (new)
- `.dockerignore`

## llm_execution
target      : cloud
reason      : ops surface, security-sensitive secrets
complexity  : low
context_size: small
