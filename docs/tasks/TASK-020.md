---
id: TASK-020
parent_us: [US-009]
parent_req: REQ-003
sprint: SPRINT-002
status: planned
estimate: 3h
---

# TASK-020 — AI provider abstraction + adapters

## Goal
Per ADR-003: `AiProvider` interface and adapters
`ClaudeProvider`, `CodexProvider`, `OpencodeProvider`, `MockProvider`.
`resolveProvider(role)` with fallback chain. Append every call to
`ai-trace.jsonl`.

## Files
- `app/lib/ai/provider.ts`
- `app/lib/ai/providers/claude.ts`
- `app/lib/ai/providers/codex.ts`
- `app/lib/ai/providers/opencode.ts`
- `app/lib/ai/providers/mock.ts`
- `app/lib/ai/resolve.ts`
- `app/lib/ai/trace.ts`

## Acceptance
- US-009 AC-5 (provider fallback).

## llm_execution
target      : cloud
reason      : external integration + security-sensitive credentials
complexity  : medium
context_size: medium
