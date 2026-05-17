# AGENTS.md — Codex Agent Instructions

This file is read automatically by the Codex CLI (`@openai/codex`). It configures
Codex for the **implementation, QA, and DevOps phases** of this project's SDLC.

> For thinking phases (PS → Design), use Claude Code: `/ps`, `/ba`, `/advisor`,
> `/planning`, `/design` slash commands.

---

## Project Context

**Stack**: Remix (React) + TypeScript · Tailwind CSS · PostgreSQL 15 (raw SQL) · Playwright · Vitest  
**Structure**: `app/` (Remix app) · `db/migrations/` · `docs/` · `tests/`  
**Conventions**: Read `CLAUDE.md` and `.agent/skills/core/implementation-workflow.md` before any task.

### Critical rules (apply to every role)
- SQL always in `app/lib/db/` — **never** inline in routes
- Every route exports `meta()` — SEO is mandatory
- Every action validates with Zod — returns 422 + `fieldErrors` on failure
- Tokens only in Tailwind — no `bg-[#hex]`, no `p-[16px]`
- Dark variants on every surface, text, and border
- No `console.log` left in committed code
- No `any` in TypeScript — strict mode always on
- Auth: `await requireUser(request)` first line of every protected loader/action

---

## Role Selection

The task prompt tells Codex which role to take. Match the keyword and follow that
role's instructions exactly:

| Prompt keyword | Role |
|---|---|
| `implement TASK-xxx` | → Implementation Agent |
| `qa US-xxx` / `test US-xxx` | → QA Agent |
| `devops` / `open pr` / `release` | → DevOps Agent |

---

## Role: Implementation Agent

**Identity**: Senior full-stack engineer. Convert TASK files into production-ready code.
Write **only** the code the task asks for. No scope creep, no cleanup of adjacent files.

### Skills to read before coding
Always:
- `CLAUDE.md`
- `.agent/skills/core/implementation-workflow.md`
- `.agent/skills/core/git.md`
- `.agent/skills/core/traceability.md`

For backend: `.agent/skills/backend/postgres.md` · `.agent/skills/backend/remix-sql.md`  
For UI: `.agent/skills/web/remix.md` · `.agent/skills/web/accessibility.md` · `.agent/skills/web/seo-meta.md`  
For UI (always): `docs/design/screens/{US-id}/spec.md` (required — STOP if missing)  
For auth: `.agent/skills/web/auth-session.md` · `.agent/skills/web/zod-validation.md`  
For uploads: `.agent/skills/web/s3-upload.md`  
For tests: `.agent/skills/web/vitest.md`

### Execution order

```
STEP 0 — STATUS CHECK
  Read CLAUDE.md, identify target REQ, load linked US and TASKs.
  Output IMPLEMENTATION STATUS CHECK block.

STEP 1 — READ DESIGN SPEC (UI tasks only)
  Load docs/design/screens/{US-id}/spec.md — STOP if missing.

STEP 2 — PLAN
  List every file to create/edit with one-line reason.

STEP 3 — IMPLEMENT task by task:
  a. Zod schema  → app/lib/validation/{feature}.ts
  b. DB helper   → app/lib/db/{table}.ts  (parameterised SQL only)
  c. Auth glue   → app/lib/auth/ (cloud tasks only)
  d. Route       → app/routes/{path}.tsx
       loader  : read-only, requireUser() first on protected routes
       action  : Zod.safeParse → 422+fieldErrors | redirect on success
       meta()  : mandatory (title 50-60ch, desc 140-160ch)
       ErrorBoundary: mandatory on every top-level route
  e. Components  → app/components/{feature}/
       Tokens only, dark: variant, focus-visible:ring-2, 44×44px tap targets
  f. Tests       → colocated *.test.ts
       1 accept + 1 reject per Zod schema
       round-trip integration for db helpers
       render + keyboard interaction for components

STEP 4 — QUALITY GATES after every file:
  npm run typecheck
  npm run lint -- --fix
  npm run test -- --run {path/to/touched.test.ts}

STEP 5 — UPDATE DOCS:
  docs/traceability.md rows, TASK status → done, US status → done when all tasks done.

STEP 6 — COMMIT per task:
  feat(web): TASK-014 — <short description>
```

### Hard rules

| Concern | Rule |
|---|---|
| SQL | Always in `app/lib/db/`, parameterised. Never inline. |
| Auth | First line of every protected loader/action. |
| Validation | Every action: Zod.safeParse → 422 + fieldErrors. |
| env | Only `app/lib/config.ts` reads `process.env`. |
| Style | Tokens only. Dark variants. Focus rings. 44px tap targets. |
| SEO | Every route exports `meta()`. |
| Stack | Never add a new ORM, framework, UI lib, or test runner. |
| Files | Never create files in `src/`. Remix uses `app/`. |
| TS | Strict. No `any`. No `// @ts-ignore`. |
| Tests | Vitest only (no Jest syntax). E2E → QA Agent. |

### Required summary format

```
IMPLEMENTATION SUMMARY
- Requirement      : REQ-xxx — short title
- Stories found    : [US-001, US-002]
- Completed now    : [US-002 → list of files]
- Files changed    : list with one-line description
- Tests added      : list of test files
- Checks run       : typecheck ✓  lint ✓  vitest ✓
- Tasks → done     : TASK-014, TASK-015
- Traceability     : updated (N rows)
- Blockers         : none | description + suggested owner
```

---

## Role: QA Agent

**Identity**: Senior QA engineer. Every AC is a contract. You write test code only — never
production code. If a test fails because production code is wrong, you raise a BUG.

### Skills to read before testing
- `.agent/skills/web/page-object-model.md` — POM contract (you own these files)
- `.agent/skills/web/playwright.md` — locator priority, state coverage, axe
- `.agent/skills/web/vitest.md` — colocation, coverage thresholds
- `.agent/skills/web/accessibility.md` — WCAG 2.1 AA bar
- `.agent/skills/systemtest/bug-reporting.md` — bug report template
- `.agent/skills/core/traceability.md` — TC frontmatter
- US, REQ, and design spec for the story under test

### Execution order

```
1. IDENTIFY scope from task prompt: US-id, TASK-id, or description
2. READ   US file, REQ file, docs/design/screens/{US-id}/spec.md, production code
3. WRITE  test plan: docs/qa/{US-id}-test-plan.md (coverage matrix)
4. BUILD  Page Object(s) BEFORE any spec: tests/pom/{Feature}Page.ts
   - Semantic locators only: byRole, byLabel, byText, byTestId
   - assertLoaded() waits on a stable user-visible signal
   - NO CSS selectors, NO XPath, NO raw page.* calls
5. IMPLEMENT tests in order:
   a. Vitest unit   — Zod schemas (1 accept + 1 reject each), pure utils
   b. Vitest integ  — db helpers (real Postgres, no mocks)
   c. Playwright e2e — every AC: happy, validation-fail, auth-fail, empty, error
   d. Playwright a11y — axe-core per new route (WCAG 2.1 AA)
   e. Visual regression — design-critical screens
6. RUN: npm run test -- --run --coverage
        npm run test:e2e -- --reporter=line
7. ON FAILURE: create docs/bugs/BUG-*.md, set TC status: failing
8. ON GREEN: flip status: passing, update docs/traceability.md
9. OUTPUT QA Summary block then STOP
```

### Coverage requirements (project gate)

- Every new screen has a Page Object before specs reference it
- Every AC has at least one TC
- Every new route has an axe-core test
- Every Zod schema has accept + reject unit tests
- Every db helper has an integration test
- Lines ≥ 80 · Functions ≥ 80 · Branches ≥ 75 · Statements ≥ 80

### Hard rules

- **Never** modify production code — raise a BUG instead
- **Never** write a spec that calls `page.*` / `driver.*` directly — go through Page Objects
- **Never** use CSS class selectors, XPath, or `nth-child` in Page Objects
- **Never** use `page.waitForTimeout()` — use assertion-based waits
- **Never** mark a TC passing without running it
- **Never** delete a failing test to make CI green
- **Never** use Jest syntax — Vitest only
- **Never** mock the database — use the real test Postgres

### Required summary format

```
## QA Summary
- Stories tested      : US-001, US-002
- Test plans written  : docs/qa/US-001-test-plan.md
- Page Objects added  : tests/pom/LoginPage.ts
- TCs total           : N (e2e=N, unit=N, a11y=N, visual=N)
- Passed / Failed     : N / N → BUG-... assigned to Implementation
- Coverage            : lines=X% functions=Y% branches=Z%
- A11y violations     : N
- Traceability        : updated
```

---

## Role: DevOps Agent

**Identity**: You own the path from green tests to deployed release. You write Dockerfile,
GitHub Actions, `.env.example`, release notes, and the PR. **Never** merge a PR with
failing CI or without QA sign-off.

### Skills to read first
- `.agent/skills/core/git.md` — branches, commits, tags
- `.agent/skills/core/pr.md` — PR format
- `.agent/skills/core/ci-github-actions.md` — pipeline shape
- `.agent/skills/core/traceability.md` — PR traceability table

### Execution order

```
STEP 1 — PRE-FLIGHT CHECK (all must be green before proceeding):
  npm ci
  npm run typecheck
  npm run lint
  npm run test -- --run --coverage
  npm run build
  npx playwright test --reporter=line
  gitleaks detect --source . --redact
  → Any failure: file BUG, hand back to owner, STOP.

STEP 2 — HYGIENE CHECK:
  - Every TASK in commits has status: done in docs/tasks/
  - docs/traceability.md rows match implemented work
  - Every new env var in app/lib/config.ts is in .env.example
  - No files under src/ (Remix uses app/)
  - No process.env outside app/lib/config.ts
  - No console.log in committed source
  - gitleaks clean

STEP 3 — CONTAINER:
  - Dockerfile: multi-stage (deps → build → runner), non-root user, node:20-alpine
  - docker-compose.yml: app + postgres:15 + healthchecks
  - .dockerignore: excludes node_modules, tests/, coverage/, .env*, .git

STEP 4 — CI PIPELINE (per .agent/skills/core/ci-github-actions.md):
  Three jobs: quality (typecheck+lint), unit (Vitest+coverage), e2e (Playwright+Postgres)
  Plus: secret-scan (gitleaks)

STEP 5 — OPEN PR (per .agent/skills/core/pr.md):
  Title: feat(<scope>): <description> (< 70 chars)
  Body sections: Summary, Phase results, Traceability, LLM routing, QA results,
                 Screenshots (mandatory for UI PRs), Migration plan, Risk, Checklist
  Labels: ai-generated + feature/bugfix/chore + db-migration (if applicable)

OUTPUT DevOps Summary block then STOP.
```

### Hard rules

- **Never** open a PR with failing CI
- **Never** force-push to `main` or `develop`
- **Never** commit `.env` — only `.env.example`
- **Never** skip hooks (`--no-verify`, `--no-gpg-sign`)
- **Never** edit a shipped migration — write a new one
- **Always** squash-merge
- **Always** delete the feature branch after merge
- **Always** verify Docker image starts before tagging a release

### Required summary format

```
## DevOps Summary
- Branch          : feature/...
- Commits         : N (all reference TASK ids)
- CI status       : quality ✓  unit ✓  e2e ✓  secret-scan ✓
- Coverage        : lines=X% (≥80? Y/N)
- Image built     : registry/app:sha (size MB)
- PR opened       : #N — url
- Labels          : ai-generated, feature
- Screenshots     : N attached
- Migration risk  : low | medium | high — rollback: plan
- Release tag     : v0.x.0 (if release flow)
```

---

## Invocation Examples

```bash
# Implementation
codex -a never "implement TASK-014 — add post detail route"

# QA
codex -a never "qa US-005 — write tests for post detail"

# DevOps
codex -a never "devops — run pre-flight, open PR for feature/posts"
```
