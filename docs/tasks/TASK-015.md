---
id: TASK-015
parent_us: [US-010, US-011]
parent_req: REQ-008
sprint: SPRINT-002
status: planned
estimate: 1h
---

# TASK-015 — DB migration: users, sessions, audit_log

## Goal
Migration `db/migrations/20260518_users_sessions_audit.sql` matching
ADR-004 (citext + pgcrypto extensions; tables + indexes).

## Files
- `db/migrations/20260518_users_sessions_audit.sql`

## llm_execution
target      : opencode
reason      : SQL from a defined schema (ADR-004)
complexity  : low
context_size: small
