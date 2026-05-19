# CLAUDE.md — AI Automation Framework

---

## Project Configuration
> Agents read this to adapt their instructions, file paths, and patterns.

```
# ── Identity ──────────────────────────────────────────────────
PROJECT_NAME   = AI Automation Framework
PLATFORM       = web

# ── Tech Stack ────────────────────────────────────────────────
# Options: remix | nextjs | angular | nuxt | sveltekit | nestjs | custom
FRAMEWORK      = remix

# Options: typescript | javascript | python
LANGUAGE       = typescript

# Options: postgresql | mysql | sqlite | mongodb | none
DATABASE       = postgresql

# Options: tailwind | sass | css-modules | styled-components
STYLING        = tailwind

# Options: custom | next-auth | clerk | auth0 | supabase | none
AUTH           = custom

# Options: playwright+vitest | jest+cypress | pytest+playwright
TESTING        = playwright+vitest

# ── AI profile ────────────────────────────────────────────────
# premium  → all thinking phases use claude; implementation uses codex
# balanced → thinking phases=claude (fallback codex), implementation=codex (fallback opencode)
AI_PROFILE     = balanced
```

> **Stack-specific patterns**: agents load `.agent/skills/stacks/{FRAMEWORK}.md`
> automatically. If your framework is not listed, they fall back to
> `.agent/skills/stacks/generic.md`.

---

## Overview
This project is an AI-powered system test automation framework for web
applications. Testers provide URLs and optional YAML or Markdown test cases;
the framework analyzes pages, generates or executes scenarios, captures
evidence, and writes structured reports for review and regression coverage.

---

## Quick Start — How to Use This Project

### Tool setup

```bash
npm install -g @openai/codex   # Codex CLI for implementation/QA/DevOps
# Claude Code is your primary interface for thinking phases
```

### Two-tool workflow

| Phase | Tool | How to run |
|-------|------|-----------|
| PS → Design (thinking) | **Claude Code** | `/ps`, `/ba`, `/advisor`, `/planning`, `/design` |
| Implementation | **Codex CLI** | `codex -a never "implement TASK-xxx"` |
| QA | **Codex CLI** | `codex -a never "qa US-xxx"` |
| DevOps / PR | **Codex CLI** | `codex -a never "devops — open PR"` |

### Recommended flow for a new feature

```bash
# 1. Write your problem statement
#    → docs/requirements/PS-001.md

# 2. In Claude Code — run thinking phases
/ps                        # Phase 0: extract REQs from PS-001.md
/ba                        # Phase 1: decompose REQs → User Stories
/planning                  # Phase 3: plan Tasks + sprints
/design US-001 US-002      # Phase 4: generate screen specs
/advisor                   # Phase 2: verify LLM routing is safe

# 3. In terminal — run implementation with Codex
codex -a never "implement TASK-001 — add users migration"
codex -a never "implement TASK-002 — add users db helper"
codex -a never "implement TASK-003 — implement login route"

# 4. In terminal — run QA with Codex
codex -a never "qa US-001 — test user registration"

# 5. In terminal — DevOps with Codex
codex -a never "devops — pre-flight and open PR for feature/auth"
```

### All Claude Code commands (type in Claude Code chat)

```
/ps [PS-file]              Phase 0  — Problem Statement → Requirements
/ba [REQ-id]               Phase 1  — Requirements → User Stories
/advisor [TASK-id]         Phase 2  — LLM routing safety review
/planning [REQ-id|US-id]   Phase 3  — User Stories → Tasks + sprints
/design US-id [US-id...]   Phase 4  — User Stories → Screen specs
/feature REQ-id            Full thinking pipeline for one requirement
/feature all               Full thinking pipeline for all requirements
/sprint start SPRINT-001   Show commands to run for a sprint's stories
/sprint status             Sprint progress dashboard
/sprint report             Generate velocity report
/sprint retro              Run a retrospective
/req "new requirement"     Add or version a requirement
/fix BUG-001               Analyse a bug and output the Codex fix command
/status                    Project dashboard: done/todo/bugs
/status REQ-001            Status scoped to one requirement
```

### Codex commands (run in terminal)

```bash
# Implementation (one task at a time)
codex -a never "implement TASK-001 — description"

# QA (one user story at a time)
codex -a never "qa US-001 — description"

# DevOps
codex -a never "devops — pre-flight check and open PR for feature/xxx"

# Bug fix
codex -a never "fix BUG-001: root-cause in app/routes/login.tsx"
```

> Codex reads `AGENTS.md` automatically for project context and role instructions.

---

## Tech Stack

| Layer    | Technology |
|----------|------------|
| Frontend | Remix + React |
| Styling  | Tailwind CSS |
| Backend  | Remix actions/loaders + CLI commands |
| Database | PostgreSQL 15 with raw SQL helpers |
| Auth     | custom |
| Testing  | Playwright + Vitest |
| CI/CD    | GitHub Actions |
| Container| Docker + docker-compose |

> Keep the Project Configuration block and this table aligned when the stack
> changes.

---

## SDLC Pipeline

### Thinking phases — Claude Code (slash commands)

```
Phase 0 — /ps        Claude native
  Input : docs/requirements/PS-001.md (problem statement)
  Output: docs/requirements/REQ-{n}.md
  Rule  : extract and group ACs from PS into logical REQ files

Phase 1 — /ba        Claude native
  Input : REQ files from Phase 0
  Output: docs/user-stories/US-{n}.md
  Rule  : every US has Given/When/Then AC, links to parent REQ

Phase 2 — /advisor   Claude native
  Input : TASK files from Phase 3
  Output: routing review (APPROVED / FLAGGED per task)
  Rule  : payment/auth/security → always cloud. NEVER local.

Phase 3 — /planning  Claude native
  Input : US files from Phase 1
  Output: docs/tasks/TASK-{n}.md + docs/decisions/ADR-{n}.md
  Rule  : backend tasks first, then frontend, then QA task

Phase 4 — /design    Claude native
  Input : US files with UI components
  Output: docs/design/screens/{US-id}/spec.md
  Rule  : Design like a senior product designer. Concrete and structured.
```

### Implementation phases — Codex CLI (AGENTS.md)

```
Phase 5 — codex "implement TASK-xxx"   Codex native
  Input : TASK files (target=cloud) + design specs
  Output: source code + updated task status
  Rule  : read spec.md before writing any UI code

Phase 5b — opencode "implement TASK-xxx"   Codex/OpenCode native
  Input : TASK files (target=local)
  Output: source code via LM Studio
  Rule  : low complexity only — schemas, migrations, mock data, docstrings

Phase 7 — codex "qa US-xxx"            Codex native
  Input : US files + implemented code
  Output: docs/qa/{US-id}-test-plan.md + test results
  Rule  : every AC → at least one Playwright test

Phase 8 — codex "devops — open PR"       Codex native
  Input : passing tests + traceability.md
  Output: GitHub PR with full phase summary
  Rule  : never merge without QA passing

Scrum Sprint Layer (wraps Phases 3–8)
  NOTE: /planning automatically creates sprint files.
        User stories are distributed into SPRINT-{n}.md by priority + capacity.
        Use /sprint to manage sprints in Claude Code.

  /sprint plan                             List sprints (Claude Code)
  /sprint plan  [SPRINT-id] US-001 US-002  Manually create/override a sprint
  /sprint start SPRINT-001                 Show commands for a sprint's stories
  /sprint status                           Show progress dashboard
  /sprint report                           Generate velocity + test report
  /sprint retro                            Run a retrospective
  Files : docs/sprints/SPRINT-{n}.md       ← created by /planning
          output/reports/SPRINT-{n}-report.md
          output/reports/retro-SPRINT-{n}.md
```

---

## Project Structure

```
app/
├── routes/
│   ├── _index.tsx               ← home / landing
│   ├── auth/
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   └── google.callback.tsx
│   └── (feature folders)
├── components/
│   ├── ui/                      ← base: Button, Input, Card, Badge
│   └── (feature components)
├── lib/
│   ├── db/                      ← SQL queries (never inline in routes)
│   ├── auth/                    ← session helpers
│   ├── storage/                 ← S3 upload helpers
│   └── validation/              ← Zod schemas
└── styles/
    └── globals.css

db/
├── migrations/                  ← YYYYMMDD_description.sql
└── seeds/                       ← seed.sql (dev only)

docs/
├── requirements/                ← PS-001.md, REQ-{n}.md
├── user-stories/                ← US-{n}.md
├── tasks/                       ← TASK-{n}.md
├── decisions/                   ← ADR-{n}.md
├── design/
│   ├── system/                  ← tokens.md, components.md, patterns.md
│   ├── screens/{US-id}/        ← design.html (primary), spec.md, brief.md, notes.md
│   ├── reference/               ← shared components, preview specimens, UI kits
│   ├── colors_and_type.css      ← canonical CSS tokens (mirrored in globals.css)
│   ├── specs-summary.md         ← inventory of all 26 user story specs
│   ├── design-system-readme.md  ← full design system documentation
│   └── SKILL.md                 ← design system skill manifest
├── qa/                          ← {US-id}-test-plan.md
├── sprints/                     ← backlog.md, SPRINT-{n}.md
└── traceability.md              ← REQ → US → TASK matrix

output/
├── reports/                     ← SPRINT-{n}-report.md, retro-SPRINT-{n}.md
└── ...
```

---

## Coding Conventions

> Stack-specific patterns (file layout, routing, ORM, component structure) live in
> `.agent/skills/stacks/{FRAMEWORK}.md`. The rules below apply to **every** stack.

### Universal rules (non-negotiable)
- Strict TypeScript — no `any`, no implicit returns
- Zod for all form/API input validation — returns 422 + `fieldErrors` on failure
- DB queries isolated in `app/lib/db/` (or equivalent) — **never inline in routes**
- Parameterised queries only — no string concatenation
- Migrations in `db/migrations/YYYYMMDD_description.sql`
- Named exports for components; default export for routes/pages
- File naming: `kebab-case` for routes/pages, `PascalCase` for components
- Auth guard first line of every protected route/loader/action
- SEO metadata exported from every public-facing route
- No `console.log` in committed code
- No `process.env` access outside `app/lib/config.ts` (or equivalent config module)

### Styling (when STYLING=tailwind)
- Utility classes only — no custom CSS unless absolutely needed
- Responsive mobile-first: `sm:` `md:` `lg:` `xl:`
- Dark mode: `dark:` class-based
- Never hardcode colors — use design token classes

### i18n (if multi-language)
- Locale always in URL: `/en/slug` vs `/vi/slug`
- Never hardcode language strings in source
- Locale param: defined in Project Configuration above

---

## API Response format

```typescript
// All data-fetching responses use this shape
type LoaderResponse<T> = {
  data: T | null
  error: string | null
  meta?: { page: number; total: number; perPage: number }
}
```

---

## Requirements Traceability

### Rules
- **NEVER edit an existing REQ file** — create `REQ-{id}-v2.md` with `supersedes` field
- Every REQ → at least one US
- Every US → at least one TASK
- Every TASK → commits that reference it
- Update `docs/traceability.md` after every phase

### ID structure
```
PS-001          Problem statement
REQ-001         Original requirement (from PS-001)
REQ-001-v2      Updated requirement (supersedes REQ-001)
US-001          User story → traces to REQ-001
TASK-001        Task → traces to US-001
TC-001          Test case → traces to US-001 AC
```

---

## LLM Routing Rules

Every `TASK-{n}.md` must have `llm_execution` filled:

```
## llm_execution
target      : cloud | opencode
reason      : why cloud or opencode
complexity  : low | medium | high
context_size: small | medium | large
```

### Providers
```
4 providers available:
  claude               — thinking phases (PS, BA, Advisor, Planning, Design)
  codex                — implementation (Phase 5), QA, DevOps
  opencode (LM Studio) — low-complexity tasks (Phase 6), default local backend
  opencode-ollama      — fallback for opencode

Fallback chains:
  claude → codex
  codex  → opencode → opencode-ollama
```

### Hard rules
```
cloud / codex (non-negotiable):
  ✗ auth / session / OAuth
  ✗ payment processing
  ✗ security-sensitive logic
  ✗ complexity: high
  ✗ new external service integration
  ✗ multi-file refactor

opencode (eligible — runs on LM Studio/Ollama):
  ✓ Zod schema from known shape
  ✓ TypeScript interface / type definitions
  ✓ SQL migration from defined schema
  ✓ Mock data / test fixtures
  ✓ Docstrings / JSDoc comments
  ✓ Basic CRUD following established pattern
  ✓ Dockerfile from known stack
  ✓ .env.example from config
```

---

## Git Conventions

```
Branches:
  feature/{short-description}
  fix/{short-description}
  chore/{description}

Commits (Conventional Commits):
  feat(web):  TASK-{id} — description
  feat(db):   TASK-{id} — description
  fix(web):   TASK-{id} — description
  test:       TASK-{id} — description
  docs:       description
  chore:      description

PRs:
  Always target develop
  Title: feat: {feature description}
  Body: traceability table + phase summary
```

---

## Environment Variables

# ── Project identity ──────────────────────────────────────────
# PLATFORM : ios | android | web | tool | embedded
# PROJECT_TYPE: ios+backend | android+backend | web+backend |
#               embedded | backend | tool
PLATFORM=web
PROJECT_TYPE=web+backend

# ── AI profile ────────────────────────────────────────────────
# premium  → all thinking phases use claude; implementation uses codex
# balanced → thinking phases=claude (fallback codex), implementation=codex (fallback opencode)
AI_PROFILE=balanced

# ── Provider registry ─────────────────────────────────────────
# Available: claude | codex | copilot | gemini | opencode
# NOTE: "local" provider has been replaced by "codex"
PREMIUM_PROVIDER=claude
BALANCED_PROVIDER=claude
DEFAULT_PROVIDER=codex

# ── Per-phase provider overrides ──────────────────────────────
# Thinking phases (PS → Design): default=claude, fallback=codex
# Implementation phase          : default=codex,  fallback=opencode
#
# PS, BA, Advisor, Architect, Design:
#   → default: claude
#   → if Claude hits rate limit: automatically falls back to codex
#
# Implementation, QA, DevOps:
#   → default: codex
#   → if Codex fails: automatically falls back to opencode (LM Studio)
#
PS_PROVIDER=claude
BA_PROVIDER=claude
ADVISOR_PROVIDER=claude
ARCHITECT_PROVIDER=claude
DESIGN_PROVIDER=claude
IMPLEMENT_PROVIDER=codex
IMPLEMENTATION_ROLE=implementation
QA_PROVIDER=codex
DEVOPS_PROVIDER=codex

# ── Fallback chains ───────────────────────────────────────────
# Thinking phases: claude → codex
CLAUDE_FALLBACK=codex
# Implementation:  codex  → opencode
CODEX_FALLBACK=opencode

# ── Codex CLI ─────────────────────────────────────────────────
# Install: npm install -g @openai/codex
# CODEX_MODEL=o4-mini
# Approval values: never | on-request | on-failure | untrusted
# 'never' = fully automated, no human prompts (pipeline mode)
CODEX_APPROVAL_MODE=never

# ── Claude Code CLI ───────────────────────────────────────────
CLAUDE_ALLOW_TOOLS=Read,Write,Edit,MultiEdit,Bash,Glob,Grep
CLAUDE_SKIP_PERMISSION=true

# ── Gemini CLI (optional) ─────────────────────────────────────
# GEMINI_CLI_COMMAND=gemini chat --model gemini-2.0-flash

# ── Copilot CLI (optional) ────────────────────────────────────
# COPILOT_CLI_COMMAND=copilot -p --allow-all-tools

# ── OpenCode CLI (LM Studio fallback for implementation) ──────
# Install: npm install -g opencode-ai
# Setup:   bash scripts/setup_opencode.sh

# ── LM Studio (used by opencode) ──────────────────────────────
LOCAL_API_URL=http://localhost:1234/v1
LOCAL_API_KEY=lm-studio
LOCAL_MODEL=google/gemma-4-26b-a4b
LOCAL_TIMEOUT=7200
LOCAL_MAX_TOKENS=8192
LOCAL_TEMPERATURE=0.1
LOCAL_RETRY=1

# ── Token guardrail for LM Studio ────────────────────────────
# Hard cap on tokens sent to LM Studio (via opencode provider).
# Prompt is truncated BEFORE sending if it exceeds this limit.
# 15000 tokens ≈ 60,000 chars — safe for most 32k context models.
LOCAL_MAX_PROMPT_TOKENS=15000
```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Auth
SESSION_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Storage
S3_ENDPOINT=...
S3_BUCKET=...
S3_ACCESS_KEY=...
S3_SECRET_KEY=...

# AI (optional)
GEMINI_API_KEY=...

# App
NODE_ENV=development|staging|production
BASE_URL=https://yourdomain.com
```

---

## How Agents Use This File

### Claude Code (thinking phases: /ps /ba /advisor /planning /design)
1. **Read CLAUDE.md first** before any task
2. **Identify phase and role** — never exceed role scope
3. **NEVER edit old REQ files** — always version with `-v2`
4. **traceability.md updated** after each phase completes
5. **Never end with a question** — write ambiguities as Open questions and proceed

### Codex (implementation phases: implement / qa / devops)
1. **Read AGENTS.md first** — it loads automatically when you run `codex`
2. **SQL stays in `app/lib/db/`** — never inline in routes or actions
3. **Every route exports `meta()`** — SEO is mandatory
4. **Zod validates every form/action input** — no raw FormData
5. **Read spec.md** before writing any UI component
6. **Every commit references a TASK-id**
7. **traceability.md updated** after each task completes
