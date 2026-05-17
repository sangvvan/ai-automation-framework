---
id: ADR-003
title: AI provider abstraction and fallback chain
status: accepted
date: 2026-05-17
deciders: planning agent
---

# ADR-003 — AI Provider abstraction

## Context
PS §17.5 + CLAUDE.md require pluggable AI providers and a fallback chain
(`claude → codex`, `codex → opencode → opencode-ollama`). The framework
must work offline (LM Studio) and online (Claude), and route by phase.

## Decision
- `AiProvider` interface in `app/lib/ai/provider.ts`:
  ```ts
  interface AiProvider {
    name: string;
    generateStructured<T>(input: { systemPrompt: string; userPrompt: string;
      schema: z.ZodType<T>; maxTokens?: number; signal?: AbortSignal; }): Promise<T>;
  }
  ```
- Adapters: `ClaudeProvider`, `CodexProvider`, `OpencodeProvider`,
  `OpencodeOllamaProvider`, `MockProvider` (test only).
- `resolveProvider(role: "design"|"validate"|"observe")` reads
  `ai-provider.yaml` and applies the fallback chain.
- Calls are retried once on transient failure (5xx, timeout). On schema
  mismatch, the prompt is re-issued with the parser error appended.
- Every call is appended to `reports/evidence/{run-id}/ai-trace.jsonl`
  with `provider, role, requestId, durationMs, status, attempt`.

## Hard rules
- No PII or page secrets in prompts: providers receive PageAnalysis with
  sensitive values masked.
- Provider keys read only by `app/lib/config.ts`.
- `MockProvider` is the **only** provider allowed in unit tests.

## Consequences
- Switching providers is config-only.
- Tests are deterministic (Mock).
- Audit trail for every model call.

## Alternatives considered
- Direct fetch to provider APIs in calling code — rejected (no audit, no
  fallback, hard to test).
