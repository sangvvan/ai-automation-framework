# LLM Routing Spec

## Purpose
Decide which provider executes each TASK so we save tokens on simple
work and keep risky work on the strongest model. Architect Agent fills
in `llm_execution.target` per task; Advisor Agent re-checks against the
hard rules below.

| target  | What it means | Default provider |
|---------|---------------|------------------|
| `cloud` | Strong model, large context, internet | Claude (per `agent.config`) |
| `local` | Codex / OpenCode + LM Studio | falls back automatically per `agent.config` |

## Field on every TASK

```yaml
llm_execution:
  target      : local | cloud
  reason      : "one short sentence"
  complexity  : low | medium | high
  context_size: small | medium | large
```

## HARD rules — must be `cloud`
A task is **always** cloud if any apply:

- Touches `app/lib/auth/`, sessions, OAuth, password hashing, CSRF
- Payment / billing / refund / subscription flows
- RBAC / permissions / admin features
- Encryption, key handling, secrets
- New external service integration (S3, OAuth provider, payment processor, email)
- Multi-file refactor (> 3 files)
- `complexity: high`
- Reading > 5 files of context to understand the task
- Editing a `db/migrations/` file for a table that has shipped to staging/prod
- CI/CD or `.github/workflows/` changes

Advisor Agent will reject any of these marked `local`.

## Eligible LOCAL tasks
A task **may** be `local` if **all** apply:
- Does not match any HARD rule above
- `context_size: small` or `medium`
- `complexity: low` (rarely `medium`)
- Falls into one of these categories:

```
✓ Zod schema for a known shape
✓ TypeScript type / interface from a sample object
✓ SQL migration from a defined schema
✓ JSDoc / comments for already-implemented functions
✓ Mock data, test fixtures
✓ Format / lint fixes following existing conventions
✓ .env.example from app/lib/config.ts
✓ Dockerfile from a known stack
✓ Basic CRUD route following an existing pattern
```

## Provider chain
Set in `.agent/config/agent.config`:
- Thinking phases (PS, BA, Advisor, Architect, Design): `claude` → `codex`
- Execution phases (Implementation, QA, DevOps): `codex` → `opencode` (LM Studio)

The orchestrator falls back automatically when the primary fails or hits a rate limit.

## Local session workflow
1. Architect fills `llm_execution.target` per task.
2. Advisor reviews and flags any rule violations.
3. Run cloud tasks via Claude Code as normal.
4. Run local tasks: `python scripts/run_local_tasks.py` (uses LM Studio + OpenCode).
5. All local output is **reviewed** by the Review Agent before merging.
