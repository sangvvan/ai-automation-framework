---
id: ADR-001
title: Runtime, orchestration, and project topology
status: accepted
date: 2026-05-17
deciders: planning agent
---

# ADR-001 — Runtime, orchestration, and project topology

## Context
PS-001 calls for an AI-driven system-test framework with a CLI and a web
Review UI. The scaffold is Remix + TS + Tailwind + PostgreSQL + Playwright +
Vitest. We must decide where the CLI lives, how it shares code with the
web app, and which process supervises Playwright runs.

## Decision
- Single Node 20 / TypeScript codebase. **One** `package.json`.
- Source tree:
  - `app/` — Remix routes + components + shared libs (`app/lib/**`).
  - `app/lib/ai/` — provider adapters (claude, codex, opencode) and the
    Test Design / Validation prompt scaffolding.
  - `app/lib/browser/` — Playwright launcher + storage-state utils.
  - `app/lib/analyzer/` — Page Analyzer.
  - `app/lib/scenario/` — Scenario types + YAML/MD parsers + step mapper.
  - `app/lib/runner/` — Keyword action library + scenario runner.
  - `app/lib/validator/` — Validation Agent.
  - `app/lib/reporter/` — JSON + HTML reporters.
  - `app/lib/review/` — DB helpers + filesystem promotion.
  - `app/lib/cli/` — CLI entrypoint + commands.
  - `app/lib/config.ts` — sole reader of `process.env`.
- CLI shipped via `scripts/ai-test.ts` (tsx) and the npm script
  `ai-test` (e.g. `npm run ai-test -- run --url …`). No new bin install
  in MVP.
- Each `ai-test run` is an in-process Playwright invocation; no separate
  worker daemon in MVP.

## Consequences
- Shared schemas (Zod) and DB helpers are used by both CLI and web UI.
- One typecheck/lint/test pipeline for all surfaces.
- The CLI can read/write the same `reports/` and `tests/approved/` paths
  the web UI surfaces.
- We avoid a microservice split until usage justifies it.

## Alternatives considered
- Separate `cli/` workspace via npm workspaces — rejected (premature
  complexity for MVP).
- Spawning a Playwright worker process per run — rejected (sequential
  in-process is fine for MVP; revisit on parallelism need).
