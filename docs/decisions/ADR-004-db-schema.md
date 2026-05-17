---
id: ADR-004
title: PostgreSQL schema for runs, scenarios, reviews, users, sessions, audit
status: accepted
date: 2026-05-17
deciders: planning agent
---

# ADR-004 — Database schema

## Context
The Review web UI (REQ-007) and the auth platform (REQ-008) need
durable state. The CLI writes runs and the web reads them.

## Decision

### Tables

```sql
-- users + sessions
users (
  id            uuid primary key default gen_random_uuid(),
  email         citext unique not null,
  password_hash text not null,
  name          text not null,
  role          text not null default 'tester'
                check (role in ('viewer','tester','test-lead')),
  created_at    timestamptz not null default now()
)

sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
)

-- runs + scenarios
runs (
  id            text primary key,         -- e.g. "R-20260517-…-abcd"
  mode          text not null check (mode in ('testcase','explore')),
  app_url       text,
  started_at    timestamptz not null,
  finished_at   timestamptz not null,
  totals        jsonb not null,           -- {total,passed,failed,skipped}
  json_report   text not null,            -- path to reports/json/*.json
  html_report   text not null,            -- path to reports/html/*/index.html
  suite_tag     text                      -- for regression-diff grouping
)

scenarios (
  id              text primary key,
  run_id          text not null references runs(id) on delete cascade,
  title           text not null,
  type            text not null,
  priority        text not null,
  page_url        text not null,
  origin          text not null check (origin in
                    ('testcase-yaml','testcase-md','ai-generated','approved')),
  result_status   text not null,
  validation      jsonb not null,
  review_status   text not null default 'pending_review'
                   check (review_status in ('pending_review','approved','rejected')),
  reviewed_by     uuid references users(id),
  reviewed_at     timestamptz,
  reject_reason   text,
  in_regression   boolean not null default false,
  spec_yaml       text                    -- canonical YAML once approved
)

audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       uuid references users(id),
  action      text not null,              -- 'approve','reject','promote','edit'
  entity      text not null,              -- 'scenario:{id}' | 'user:{id}'
  payload     jsonb not null              -- snapshot for diff/repro
)
```

### Indexes
- `scenarios(run_id)`, `scenarios(review_status)`,
  `runs(started_at desc)`, `audit_log(at desc)`.

### Constraints
- `citext` for case-insensitive email matching (create extension citext).
- `gen_random_uuid()` from pgcrypto.

## Consequences
- All review actions transactional.
- Append-only audit log via insert-only privilege at the app layer.
- Reports linked by path (cheap) rather than blob (avoid bloat).

## Alternatives considered
- Storing report JSON in DB column — rejected (large, version drift).
