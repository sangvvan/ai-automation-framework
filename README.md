# Web Application SDLC Template

An AI-agent-driven template for building production web applications with a
two-tool workflow: **Claude Code** handles thinking (planning, design) and
**Codex CLI** handles execution (implementation, QA, DevOps).

```
Stack = Remix + TypeScript + Tailwind + PostgreSQL (raw SQL)
      + Playwright + Vitest + Docker + GitHub Actions
```

---

## Setup (5 minutes)

```bash
# 1. Install tools
npm install                          # project dependencies
npm install -g @openai/codex         # Codex CLI for implementation

# 2. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL, SESSION_SECRET (minimum required)

# 3. Start database
docker compose up -d postgres

# 4. Run migrations
npm run db:migrate

# 5. Verify everything
# In Claude Code, run:
#   /onboard check
```

---

## Two-tool workflow

| Phase | Tool | Command |
|---|---|---|
| Write problem statement | You | Edit `docs/requirements/PS-001-template.md` |
| PS → Requirements | **Claude Code** | `/ps` |
| REQ → User Stories | **Claude Code** | `/ba` |
| US → Tasks + Sprints | **Claude Code** | `/planning` |
| US → Screen specs | **Claude Code** | `/design US-001` |
| Verify LLM routing | **Claude Code** | _(built into /planning)_ |
| Implement tasks | **Codex CLI** | `codex -a never "implement TASK-001"` |
| Write tests | **Codex CLI** | `codex -a never "qa US-001"` |
| Open PR | **Codex CLI** | `codex -a never "devops — open PR"` |

---

## Quickest path: one feature end-to-end

```bash
# 1. Copy and fill the problem statement template
cp docs/requirements/PS-001-template.md docs/requirements/PS-001.md
# Edit PS-001.md

# 2. In Claude Code — run thinking phases
/ps                     # generates REQ-*.md files
/ba                     # generates US-*.md files
/planning               # generates TASK-*.md + sprint files
/design US-001 US-002   # generates design specs for UI stories

# 3. Get all implementation commands at once
/sprint execute SPRINT-001

# 4. Copy and run each codex command in terminal (in order)
codex -a never "implement TASK-001 — add engineers table migration"
codex -a never "implement TASK-002 — ..."
# ...
codex -a never "qa US-001 — test engineer directory"
codex -a never "devops — pre-flight and open PR for feature/sprint-001"
```

---

## All Claude Code commands

```
/onboard [check|ps]     New developer setup and environment check
/ps [PS-file]           Phase 0 — Problem Statement → Requirements
/ba [REQ-id]            Phase 1 — Requirements → User Stories
/planning [REQ-id]      Phase 3 — User Stories → Tasks + Sprints (includes routing check)
/design US-id [...]     Phase 4 — User Stories → Screen specs
/feature REQ-id|all     Full thinking pipeline for one or all requirements
/sprint execute SPRINT-001   Output all Codex commands for a sprint in order
/sprint status          Sprint progress dashboard
/sprint report          Velocity + test report
/sprint retro           Retrospective
/validate [REQ-id]      Check doc consistency (broken links, missing specs, etc.)
/status [REQ-id]        Project dashboard
/fix BUG-001            Analyse bug, output Codex fix command
/req "description"      Add or version a requirement
/advisor [TASK-id]      Standalone LLM routing review (optional — /planning includes this)
```

---

## Quality gates

```bash
npm run typecheck         # TypeScript strict check
npm run lint              # ESLint
npm run test              # Vitest unit + integration
npm run build             # Remix build
npm run test:e2e          # Playwright e2e (needs app running)
```

CI runs all gates on every PR. All must be green before merge.

---

## Project structure

```
app/
├── routes/              ← Remix flat-routes (kebab-case files)
├── components/{ui,...}  ← UI components (PascalCase)
└── lib/
    ├── config.ts        ← ONLY file that reads process.env
    ├── db/              ← parameterised SQL helpers (never inline in routes)
    ← auth/              ← session, OAuth, password
    ├── storage/         ← S3 helpers
    └── validation/      ← Zod schemas

db/migrations/           ← YYYYMMDD_description.sql

docs/
├── requirements/        ← PS-001-template.md + PS-001.md + REQ-{n}.md
├── user-stories/        ← US-{n}.md
├── tasks/               ← TASK-{n}.md
├── decisions/           ← ADR-{n}-{slug}.md
├── design/screens/{US}/ ← spec.md per screen
├── sprints/             ← SPRINT-{n}.md + backlog.md
├── qa/                  ← {US-id}-test-plan.md
├── bugs/                ← BUG-{n}.md
└── traceability.md      ← REQ → US → TASK matrix (append-only)

tests/
├── e2e/                 ← Playwright specs (use Page Objects only)
├── pom/                 ← Page Object Model files
└── fixtures/            ← seed data for tests

.claude/commands/        ← Claude Code slash commands (source of truth for thinking phases)
AGENTS.md                ← Codex instructions (auto-read on every codex run)
CLAUDE.md                ← Full project conventions
```

---

## Key conventions

- SQL always in `app/lib/db/` — never inline in routes
- Every route exports `meta()` — SEO mandatory
- Every action validates with Zod → 422 + fieldErrors on failure
- Tailwind tokens only — no raw hex/px values
- Dark variant on every surface, text, border class
- No `console.log` in committed code
- `target: cloud` for auth/payment/security — non-negotiable
- `target: opencode` for schemas, migrations, mock data, docstrings

See `CLAUDE.md` for the full convention contract.  
See `AGENTS.md` for Codex role instructions.  
See `.agent/skills/` for technique libraries used by agents.
