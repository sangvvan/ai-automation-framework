#!/usr/bin/env bash
# scripts/orchestrate.sh
# Phase pipeline driver.
# Called by run.sh — do not call directly unless debugging.
#
# Providers : claude | codex | copilot | gemini | opencode | opencode-ollama
# Routing   : Thinking phases (PS→Design) = claude → fallback codex
#             Implementation+             = codex  → fallback opencode
#
# Usage: orchestrate.sh <cmd> <prompt> [provider] [mode] [only] [from] [skip]

set +e

CMD="${1:-}"
PROMPT="${2:-}"
PROVIDER_OVERRIDE="${3:-}"
MODE_OVERRIDE="${4:-}"
ONLY="${5:-}"
FROM="${6:-}"
SKIP="${7:-}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source .agent/config/agent.config 2>/dev/null || true

# Phase registry — order matters
# Phase 0 = ps (problem statement → requirements)
ALL_PHASES=(ps ba advisor planning design implementation local_tasks qa devops)

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
header()   { echo -e "\n${BLUE}══ $1 ══${NC}\n"; }
done_msg() { echo -e "\n${GREEN}✓ $1${NC}\n"; }
warn()     { echo -e "\n${YELLOW}⚠ $1${NC}\n"; }
err()      { echo -e "\n${RED}✗ $1${NC}\n"; }

# ── Phase title ───────────────────────────────────────────────
phase_title() {
  case "$1" in
    ps)                    echo "Phase 0 — PS Agent — Problem Statement → Requirements" ;;
    ba)                    echo "Phase 1 — BA Agent — User Stories" ;;
    advisor)               echo "Phase 2 — Advisor Agent — LLM Routing Review" ;;
    planning|architect)    echo "Phase 3 — Planning Agent — Tasks + Technical Plan" ;;
    design)                echo "Phase 4 — Design Agent — UI/UX Specs + Mockups" ;;
    implementation)        echo "Phase 5 — Implementation Agent — Code" ;;
    local_tasks)           echo "Phase 6 — Local Task Runner — Low Complexity Tasks" ;;
    qa)                    echo "Phase 7 — QA Agent — Tests + Validation" ;;
    devops)                echo "Phase 8 — DevOps Agent — CI/CD + PR" ;;
    *)                     echo "Phase — $1" ;;
  esac
}

# ── Phase normalization ───────────────────────────────────────
normalize_phase() {
  case "$1" in
    0|problem-statement|problem_statement)  echo "ps" ;;
    1|req|requirements)                     echo "ba" ;;
    2|strategy)                             echo "advisor" ;;
    3|arch|architect)                       echo "planning" ;;
    4)                                      echo "design" ;;
    5|implement)                            echo "implementation" ;;
    6|local|local-tasks|local_tasks)        echo "local_tasks" ;;
    7|test|tests)                           echo "qa" ;;
    8|deploy|release)                       echo "devops" ;;
    *)                                      echo "$1" ;;
  esac
}

is_valid_phase() {
  case "$1" in
    ps|ba|advisor|planning|architect|design|implementation|local_tasks|qa|devops) return 0 ;;
    *) return 1 ;;
  esac
}

# ── Resolve initial phase list from command ───────────────────
resolve_initial_phases() {
  case "$CMD" in
    /feature)              PHASES=("${ALL_PHASES[@]}") ;;
    /ps|/problem)                       PHASES=(ps) ;;
    /ba)                                PHASES=(ba) ;;
    /advisor)                           PHASES=(advisor) ;;
    /planning|/architect)               PHASES=(planning) ;;
    /design)                            PHASES=(design) ;;
    /implement|/implementation)         PHASES=(implementation) ;;
    /qa)                                PHASES=(qa) ;;
    /devops)                            PHASES=(devops) ;;
    *)
      err "orchestrate.sh: unknown command: $CMD"
      exit 1
      ;;
  esac
}

# ── Phase filters ─────────────────────────────────────────────
apply_only() {
  [ -z "$ONLY" ] && return
  local parsed=()
  IFS=',' read -ra items <<< "$ONLY"
  for item in "${items[@]}"; do
    local p
    p="$(normalize_phase "$(echo "$item" | xargs)")"
    if ! is_valid_phase "$p"; then err "Invalid phase in --only: $item"; exit 1; fi
    parsed+=("$p")
  done
  PHASES=("${parsed[@]}")
}

apply_from() {
  [ -z "$FROM" ] && return
  local from_phase
  from_phase="$(normalize_phase "$FROM")"
  if ! is_valid_phase "$from_phase"; then err "Invalid phase in --from: $FROM"; exit 1; fi

  # Build full ordered list starting from from_phase
  local ordered=()
  local start=false
  for p in "${ALL_PHASES[@]}"; do
    [ "$p" = "$from_phase" ] && start=true
    [ "$start" = true ] && ordered+=("$p")
  done

  # If PHASES already contains more than one entry (e.g. /feature), replace with
  # the ordered subset. If PHASES is a single phase (e.g. /implement), only keep
  # phases that were already in PHASES (intersection) — prevents unintended
  # downstream phase expansion when --from is used with a single-phase command.
  if [ "${#PHASES[@]}" -le 1 ]; then
    # Single-phase command: --from is a no-op (phase already selected)
    return
  fi

  PHASES=("${ordered[@]}")
}

apply_skip() {
  [ -z "$SKIP" ] && return
  local skip_list=()
  IFS=',' read -ra items <<< "$SKIP"
  for item in "${items[@]}"; do
    local p
    p="$(normalize_phase "$(echo "$item" | xargs)")"
    if ! is_valid_phase "$p"; then err "Invalid phase in --skip: $item"; exit 1; fi
    skip_list+=("$p")
  done
  local filtered=()
  for p in "${PHASES[@]}"; do
    local skip=false
    for s in "${skip_list[@]}"; do [ "$p" = "$s" ] && skip=true && break; done
    [ "$skip" = false ] && filtered+=("$p")
  done
  PHASES=("${filtered[@]}")
}

# ── Provider resolver ─────────────────────────────────────────
resolve_provider() {
  [ -n "$PROVIDER_OVERRIDE" ] && echo "$PROVIDER_OVERRIDE" && return
  case "$1" in
    ps)                  [ -n "${PS_PROVIDER:-}"         ] && echo "$PS_PROVIDER"       && return ;;
    ba)                  [ -n "${BA_PROVIDER:-}"         ] && echo "$BA_PROVIDER"       && return ;;
    advisor)             [ -n "${ADVISOR_PROVIDER:-}"    ] && echo "$ADVISOR_PROVIDER"  && return ;;
    planning|architect)  [ -n "${PLANNING_PROVIDER:-${ARCHITECT_PROVIDER:-}}" ] && \
                           echo "${PLANNING_PROVIDER:-$ARCHITECT_PROVIDER}"            && return ;;
    design)              [ -n "${DESIGN_PROVIDER:-}"     ] && echo "$DESIGN_PROVIDER"   && return ;;
    implementation)      [ -n "${IMPLEMENT_PROVIDER:-}"  ] && echo "$IMPLEMENT_PROVIDER" && return ;;
    local_tasks)         [ -n "${LOCAL_TASKS_PROVIDER:-}" ] && echo "$LOCAL_TASKS_PROVIDER" && return
                         echo "opencode" && return ;;
    qa)                  [ -n "${QA_PROVIDER:-}"         ] && echo "$QA_PROVIDER"       && return ;;
    devops)              [ -n "${DEVOPS_PROVIDER:-}"     ] && echo "$DEVOPS_PROVIDER"   && return ;;
  esac
  local profile="${MODE_OVERRIDE:-${AI_PROFILE:-balanced}}"
  case "$profile" in
    premium) echo "${PREMIUM_PROVIDER:-claude}" ;;
    *)       echo "${BALANCED_PROVIDER:-claude}" ;;
  esac
}

# ── Phase prompt builders ─────────────────────────────────────
build_ps_prompt() {
  local ps_file
  ps_file="$(ls docs/requirements/PS-*.md 2>/dev/null | head -1)"
  if [ -z "$ps_file" ]; then
    echo "No PS-*.md found in docs/requirements/. Skipping PS phase."
    echo "Tip: save your problem statement as docs/requirements/PS-001.md"
    return
  fi
  cat <<PROMPT
You are the BA Agent running Phase 0: Problem Statement extraction.

Read the Problem Statement at: $ps_file

Extract and create structured REQ files from it:

1. Group the acceptance criteria into logical functional areas.
   Example groupings (adjust to what the PS actually contains):
   - Product catalog (browse, search, filter, detail)
   - Shopping cart and checkout
   - Payment integration
   - User authentication and profile
   - Order history
   - Non-functional requirements (performance, security, accessibility)

2. For each group, create docs/requirements/REQ-{n}.md with:
   - id, version: 1, status: approved, created_at: $(date +%Y-%m-%d), requested_by: Product Owner
   - supersedes: (none)
   - Business need: why this exists (from PS goals)
   - Scope IN and OUT (from PS scope section)
   - Acceptance criteria: adapted from PS ACs
   - Edge cases: from PS failure modes
   - Linked User Stories: leave empty (Phase 1 fills this)

3. Update docs/traceability.md — add REQ rows, link to the PS file.

Do NOT create User Stories yet. That is Phase 1 (BA).

Output:
## Phase 0 Summary
| REQ | Title | AC count |
Status: PASSED
PROMPT
}

build_design_prompt() {
  local mode="${DESIGN_MODE:-manual}"
  cat <<PROMPT
You are the Design Agent.
Platform: ${PLATFORM:-web}
Feature: $PROMPT

EXECUTION ORDER (mandatory — no skipping):
1. Read docs/design/system/tokens.md (token contract — never use raw hex/px).
2. Read docs/design/system/components.md (existing component library).
3. Read docs/design/system/patterns.md (established interaction patterns).
4. For each User Story with UI scope, read the full US file from docs/user-stories/.
5. For each US with UI, create docs/design/screens/{US-id}/spec.md using EXACTLY
   the 13-section structure below. Do NOT omit any section.
6. If you introduce a new reusable component, add it to docs/design/system/components.md.
7. Update docs/traceability.md — add design rows.
8. Output the summary block then STOP.

MANDATORY SPEC STRUCTURE — every spec.md must have all 13 sections:
  ## 1. Purpose         — one sentence: what decision/action does this screen enable?
  ## 2. Route + persona — Remix route file path, URL pattern, required role
  ## 3. Layout          — mobile-first, named regions (top→bottom), ASCII grid
  ## 4. Components used — table: Name | Source | Variants | Notes
  ## 5. Typography      — table: Element | Token | Class | Weight | Color
  ## 6. Spacing         — table: Region | Value | Class (4px/Tailwind grid)
  ## 7. Color           — table: Surface | Light | Dark | Class (tokens only, no hex)
  ## 8. Interactions    — table: Element | Trigger | Result | Animation
  ## 9. Accessibility   — heading order, tab order, focus rings, live regions, contrast
  ## 10. Responsive     — table: Breakpoint | Behavior (sm/md/lg/xl)
  ## 11. States         — table: State | Visual | Copy (loading/empty/error/offline/partial)
  ## 12. SEO            — title pattern, description length, og:image, robots
  ## 13. Implementation notes — Remix Form, Zod schema location, auth guard, token rules

HARD RULES:
- NEVER use raw hex (#fff) or pixel values (p-[16px]) — tokens only.
- NEVER ship a spec missing any of the 13 sections.
- NEVER ship without empty, error, and loading states specified.
- NEVER ship without focus rings specified on every interactive element.
- NEVER end with a question or leave any design decision for the implementer.
- NEVER use vague words: "nice", "modern", "clean", "intuitive".

$(if [ "$mode" = "manual" ]; then
echo 'Output "## Design Spec Summary" with: Stories designed, Specs written (paths), New components, Token changes, A11y notes. Then STOP.'
else
echo 'Call the design API for each US and save results. Output "## Design Auto Summary" then STOP.'
fi)
PROMPT
}

build_impl_prompt() {
  cat <<PROMPT
IMPLEMENTATION TARGET:
$PROMPT

MANDATORY EXECUTION ORDER — follow every step, no skipping:

STEP 0 — STATUS CHECK (output this block before any code):
  - Read CLAUDE.md for project conventions.
  - If target starts with REQ-: scan docs/user-stories/*.md for "traces_to: <REQ-id>".
  - If target starts with TASK-: read docs/tasks/<TASK-id>.md, then its linked US and REQ.
  - Check each US against app/routes/ and app/lib/db/ for existing coverage.
  - Output:
      IMPLEMENTATION STATUS CHECK
      - REQ resolved      : REQ-xxx
      - User stories      : [US-001, US-002]
      - Already done      : [...]
      - Will implement    : [...]
      - Action            : enhance | implement-missing | implement-all | skip

STEP 1 — READ DESIGN SPEC (UI tasks):
  - For each US: load docs/design/screens/{US-id}/spec.md — HIGHEST PRIORITY.
  - If no spec.md exists for a UI task → STOP, report missing spec as a blocker.
  - Also read docs/design/system/tokens.md, components.md, patterns.md.

STEP 2 — IMPLEMENT task-by-task in order. Per task:
  a) Add/extend Zod schema in app/lib/validation/ (every action validates with Zod).
  b) Add/extend DB helper in app/lib/db/ (parameterised SQL, never inline in routes).
  c) Add/extend auth glue in app/lib/auth/ (cloud-only tasks).
  d) Build route in app/routes/:
       - loader: read-only, requireUser() first line of protected routes.
       - action: validate with Zod → 422+fieldErrors on failure, redirect on success.
       - meta(): export on every route (title 50-60 chars, description 140-160 chars).
       - ErrorBoundary: export on every top-level route.
  e) Build/extend UI components in app/components/:
       - Tailwind tokens only (bg-brand not bg-[#2563eb]).
       - dark: variant on every surface/text/border class.
       - focus-visible:ring-2 focus-visible:ring-brand on every interactive element.
       - Min 44×44px tap targets. Semantic HTML (<button> not <div onClick>).
  f) Add Vitest tests (colocated *.test.ts):
       - Zod schema: 1 accept-case + 1 reject-case minimum.
       - DB helper: round-trip integration test.
       - Component: render + 1 keyboard-interaction test.
  g) Run quality gates after EVERY file — fix before moving on:
       npm run typecheck
       npm run lint -- --fix
       npm run test -- --run <path/to/touched.test.ts>

STEP 3 — UPDATE TRACEABILITY:
  - Update docs/traceability.md rows.
  - Flip US status to done when all linked tasks complete.

STEP 4 — COMMIT per task:
  - feat(web): TASK-014 — <short description>

HARD RULES:
- SQL always in app/lib/db/ — never inline in routes.
- No any, no @ts-ignore, no console.log left in code.
- Never create files in src/ — Remix uses app/.
- Never add a new ORM, framework, UI lib, or test runner.
- spec.md is HIGHEST PRIORITY — overrides any visual design link.
- Do NOT expand scope beyond the identified tasks.
PROMPT
}

build_ba_prompt() {
  cat <<PROMPT
You are the BA Agent running Phase 1: User Story decomposition.
Feature/REQ target: $PROMPT

EXECUTION ORDER (mandatory — no skipping):
1. Read all docs/requirements/REQ-*.md with status: active.
2. If target is REQ-xxx: decompose ONLY that REQ.
   Otherwise: decompose every active REQ with no linked US yet.
3. For each REQ, decompose into the smallest user-valuable slices (≤5 points each).
4. Write User Stories in Connextra form:
     As a {real-persona}
     I want {capability}
     So that {business outcome}
5. Write Given/When/Then ACs per story. Number them AC-1, AC-2, ...
   Cover MINIMUM: happy path, validation failure, auth failure, empty state, error state.
6. Mark non-functional ACs (a11y, perf, SEO, i18n) for any UI story.
7. Create docs/user-stories/US-{n}.md using the required frontmatter:
     id, title, status: todo, traces_to, points, created_at, linked_tasks: [], persona
8. Update docs/traceability.md — add US rows linking REQ→US.

HARD RULES:
- linked_tasks stays [] — Planning Agent fills it in Phase 3.
- Never edit an existing REQ — escalate to PS Agent.
- Never write tasks or design specs.
- Never use "user" as persona — use a real role (visitor, registered user, admin, editor).
- Never end with a question.

Output:
## BA Summary
- REQs decomposed      : REQ-001, REQ-002
- User Stories created  : US-001..US-00N
- Average size (points) : N.N
- Stories needing design: list ids (those with UI scope)
- Open questions raised : count + topics
- Traceability          : updated (N rows added)
Status: PASSED
PROMPT
}

build_advisor_prompt() {
  cat <<PROMPT
You are the Advisor Agent running Phase 2: LLM routing review.
Feature/target: $PROMPT

EXECUTION ORDER (mandatory):
1. Read all docs/tasks/TASK-*.md with status: todo.
2. For each task apply HARD RULES first. Violation → FLAGGED-HARD.
3. Apply SOFT RULES. Violation → FLAGGED-SOFT.
4. Otherwise → APPROVED.
5. Cite the rule violated for every flag.

PROVIDER ROUTING (4 providers available):
  cloud  → codex (Phase 5, fallback: opencode → opencode-ollama)
  opencode → LM Studio or Ollama (Phase 6, low-complexity only)

HARD RULES (auto-fail — must route to cloud/codex):
- Touches app/lib/auth/, session, OAuth, password, CSRF → cloud
- Touches payment, billing, refund, subscription → cloud
- Touches RBAC, permission checks, admin features → cloud
- Adds/changes encryption, key handling, secrets → cloud
- New external service integration (S3, OAuth, payment, email) → cloud
- Refactors > 3 files → cloud
- complexity: high → cloud
- Requires reading > 5 files of context → cloud
- Modifies db/migrations/ for a table already in staging/prod → cloud
- Touches CI/CD or .github/workflows → cloud

SOFT RULES (flag for review):
- opencode + context_size: large → likely too much context for local model
- opencode + touches > 3 files → consider splitting or escalating to codex
- opencode + no test plan referenced → flag
- opencode + "complex" in the description → flag

HARD RULES for this agent:
- NEVER modify task files. Read-only.
- NEVER approve a hard-rule violation.
- NEVER end with a question.

Output the ## Advisor Report block then STOP:
## Advisor Report
Date: $(date +%Y-%m-%d)
Tasks reviewed: N

### Approved (M)
| TASK | target | provider | reason ok? |

### FLAGGED-HARD (must fix before implementation)
| TASK | current | required | rule violated |

### FLAGGED-SOFT (review recommended)
| TASK | concern | suggested action |

### Routing summary
- cloud (codex): N (% of total)
- opencode (LM Studio/Ollama): N (% of total)
- flagged: N hard, M soft
PROMPT
}

build_planning_prompt() {
  local sprint_capacity="${SPRINT_CAPACITY:-20}"
  cat <<PROMPT
You are the Planning Agent running Phase 3: Task decomposition, technical planning, and sprint distribution.
Feature/REQ target: $PROMPT

EXECUTION ORDER (mandatory — no skipping):
1. READ   package.json, CLAUDE.md to understand stack.
2. READ   app/lib/db/, app/routes/, db/migrations/ — never introduce what already exists.
3. READ   all US-*.md with status: todo for the target REQ.
4. READ   the linked REQ file(s).
5. DECOMPOSE each US into TASK files in this canonical order per US:
   a. db/migrations/YYYYMMDD_{action}_{table}.sql
   b. app/lib/db/{table}.ts
   c. app/lib/validation/{feature}.ts  (Zod schemas)
   d. app/lib/auth/ (cloud-only if auth-touching)
   e. app/routes/{path}.tsx  (loader + action + meta + ErrorBoundary)
   f. app/components/{feature}/*.tsx
   g. colocated *.test.ts
6. SET    llm_execution for EVERY task (see cloud/local rules below).
7. WRITE  ADRs for non-obvious decisions (new library, schema choice, pattern).
8. UPDATE linked_tasks: [...] in each US frontmatter.
9. UPDATE docs/traceability.md (add TASK rows).
10. DISTRIBUTE US into sprint plan files (see Sprint Planning below).

PROVIDER ROUTING (4 providers available):
  cloud  → codex (Phase 5, fallback: opencode → opencode-ollama)
  opencode → LM Studio or Ollama (Phase 6, low-complexity only)

CLOUD / CODEX ROUTING (non-negotiable):
- auth, session, OAuth, password, CSRF → cloud
- payment/billing/refund → cloud
- security-sensitive logic → cloud
- new external service integration → cloud
- multi-file refactor (>3 files) → cloud
- complexity: high → cloud

OPENCODE ROUTING (eligible — runs on LM Studio/Ollama):
- Zod schema from known shape
- TypeScript types from defined model
- SQL migration from defined schema
- Mock data / fixtures
- JSDoc / docstrings
- Basic CRUD following existing pattern
- Dockerfile / .env.example

SPRINT PLANNING (Step 10 — mandatory):

Sprint capacity : ${sprint_capacity} points per sprint
Sprint duration : 14 days

Algorithm — first-fit bin packing by priority:
  Sort US: critical → high → medium → low → unset (within priority: preserve file order)
  For each US (in priority order):
    us_points = "points" field from US frontmatter (default 3 if missing/zero)
    if current_sprint_points + us_points > ${sprint_capacity} AND current_sprint_points > 0:
      increment sprint number, reset current_sprint_points = 0
    add US to current sprint

For each sprint N (starting at the next available SPRINT number in docs/sprints/):
  - Check if docs/sprints/SPRINT-{N:03d}.md already exists.
    If it does → SKIP it (never overwrite an in-progress sprint).
  - Otherwise write docs/sprints/SPRINT-{N:03d}.md with:
      frontmatter: id, goal (one sentence summarising the stories), status: planning,
                   start (today for sprint 1, today+14 for sprint 2, etc.),
                   end (start+13), duration: 14 days,
                   points_planned (sum of US points), points_completed: 0,
                   user_stories: [US-xxx, ...]
      body: ## Goal, ## Duration, ## User Stories table (US | Title | Points | Priority | Status),
            ## Sprint Capacity, ## Phase Log (empty table), ## Definition of Done (checkboxes)

After writing all sprint files, rewrite docs/sprints/backlog.md as a sprint assignment table:
  columns: Sprint | US | Title | Points | Priority
  One row per US, sorted by sprint then priority.

HARD RULES:
- Never write implementation code.
- Never add ORM/framework/UI lib without an ADR.
- Never mark auth/payment/security as opencode — must be cloud.
- One task = one PR-able unit (max 5 files; split if larger).
- Never overwrite a sprint file that already exists.
- Never end with a question.

Output:
## Planning Summary
- REQs covered      : REQ-001, REQ-002
- US covered        : US-001..US-007
- Tasks created     : TASK-001..TASK-024
- ADRs created      : ADR-001 (slug), ADR-002 (slug)
- Routing breakdown : cloud(codex)=N, opencode=N
- Risks flagged     : list TASK ids needing extra review
- Traceability      : updated (N rows added)
- Sprints planned   : SPRINT-001 (US-001,US-002 / N pts), SPRINT-002 (...)
PROMPT
}

build_qa_prompt() {
  cat <<PROMPT
You are the QA Agent running Phase 7: Test planning and execution.
QA TARGET: $PROMPT

EXECUTION ORDER (mandatory — no skipping):

STEP 1 — IDENTIFY SCOPE:
  - US-id: test that story's ACs only.
  - TASK-id: test that task's implementation scope.
  - Description: derive scope from context.
  Read: US file, REQ file, docs/design/screens/{US-id}/spec.md, implementation code.

STEP 2 — WRITE TEST PLAN FIRST (docs/qa/{US-id}-test-plan.md):
  Coverage matrix: TC-id | AC | Type | File | Notes
  Types: e2e, unit, a11y, visual, integration, security

STEP 3 — BUILD PAGE OBJECT(S) BEFORE ANY SPEC (tests/pom/{Feature}Page.ts):
  - Extend BasePage from tests/pom/BasePage.ts
  - Semantic locators only: byRole, byLabel, byText, byTestId
  - Expose actions as imperative methods (fillEmail, submit, loginAs)
  - assertLoaded() must wait on a stable user-visible signal
  - Must use Playwright driver via the POM contract
  - Verify: npm run test:e2e -- {spec}

STEP 4 — IMPLEMENT TESTS in this order:
  a. Vitest unit    — Zod schemas (1 accept + 1 reject per schema)
  b. Vitest integration — db helpers against real Postgres
  c. Playwright e2e — every AC: happy-path, validation-fail, auth-fail, empty, error
     Specs use Page Objects ONLY — never raw page.* calls
  d. Playwright a11y — axe-core per route (WCAG 2.1 AA)
  e. Visual regression — for design-critical screens (home, dashboard, key flows)

STEP 5 — RUN AND RECORD:
  npm run test -- --run --coverage
  npm run test:e2e -- --reporter=line

STEP 6 — ON FAILURE:
  - Create docs/bugs/BUG-*.md per bug-reporting skill
  - Set failing TC status: failing in test plan
  - Hand bug back to Implementation Agent
  - NEVER mask failures with retries/xfail/skip

STEP 7 — ON ALL GREEN:
  - Flip test plan status: passing
  - Update docs/traceability.md: Test column → TC ids, Status → done
  - Confirm coverage thresholds (80/80/75/80) still green

HARD RULES:
- NEVER modify production code — raise a BUG instead.
- NEVER write a spec that calls page.* or driver.* directly.
- NEVER put CSS class selectors or XPath in a Page Object.
- NEVER mark a TC passing without running it.
- NEVER delete a failing test to make CI green.
- EVERY new route gets an axe-core test.
- EVERY new screen gets a Page Object BEFORE specs.

Output:
## QA Summary
- Stories tested     : US-001, US-002
- Test plans written : docs/qa/US-001-test-plan.md, ...
- Page Objects added : tests/pom/LoginPage.ts, ...
- POM verified       : ✓ (verified under Playwright)
- TCs total          : N (e2e=N, unit=N, a11y=N, visual=N)
- Passed / Failed    : N / N
- Coverage           : lines=X% functions=Y% branches=Z%
- A11y violations    : N
- Traceability       : updated
PROMPT
}

build_devops_prompt() {
  cat <<PROMPT
You are the DevOps Agent running Phase 8: CI/CD and PR creation.
Feature/target: $PROMPT

EXECUTION ORDER (mandatory — do not open PR if any step fails):

STEP 1 — PRE-FLIGHT CHECK (all must pass):
  npm ci
  npm run typecheck
  npm run lint
  npm run test -- --run --coverage
  npm run build
  npx playwright test --reporter=line
  gitleaks detect --source . --redact
  If any fail → file a BUG, hand back to the right owner. DO NOT open PR.

STEP 2 — VERIFY HYGIENE:
  - Every TASK referenced in commits exists in docs/tasks/ and is status: done
  - docs/traceability.md rows match implemented work
  - Every new env var read by app/lib/config.ts is in .env.example
  - No files created in src/ (Remix uses app/)
  - No process.env outside app/lib/config.ts
  - No console.log in committed source
  - gitleaks clean

STEP 3 — CONTAINER CHECK:
  - Dockerfile: multi-stage (deps → build → runner), non-root user, node:20-alpine
  - docker-compose.yml: app + postgres:15 + healthchecks
  - .dockerignore: excludes node_modules, tests/, coverage/, .env*, .git

STEP 4 — OPEN THE PR (per core/pr.md format):
  Title: feat(<scope>): <description> (under 70 chars)
  Required body sections:
    1. Summary (≤2 sentences)
    2. Phase results table
    3. Traceability table (REQ → US → TASK → Test → Status)
    4. LLM routing breakdown
    5. QA results
    6. Screenshots / recordings (MANDATORY for UI-touching PRs)
    7. Migration plan (DB migrations, env vars, breaking changes)
    8. Risk assessment + rollback strategy
    9. Pre-merge checklist (every box ticked)
  Labels: ai-generated + feature/bugfix/chore + db-migration (if applies)

HARD RULES:
- Never open PR with failing CI.
- Never merge without QA sign-off (test plan status: passing).
- Never force-push to main or develop.
- Never commit .env — only .env.example.
- Always squash-merge. Always delete feature branch after merge.
- Never end with a question.

Output:
## DevOps Summary
- Branch            : feature/...
- CI status (local) : quality ✓ unit ✓ e2e ✓ secret-scan ✓
- Coverage          : lines=X% (≥80? Y/N)
- PR opened         : #N — url
- Labels            : ai-generated, feature, ...
- Screenshots       : N attached
- Migration risk    : low | medium | high — rollback: plan
PROMPT
}

build_phase_prompt() {
  local phase="$1"
  case "$phase" in
    ps)                    build_ps_prompt ;;
    ba)                    build_ba_prompt ;;
    advisor)               build_advisor_prompt ;;
    planning|architect)    build_planning_prompt ;;
    design)                build_design_prompt ;;
    implementation)        build_impl_prompt ;;
    qa)                    build_qa_prompt ;;
    devops)                build_devops_prompt ;;
    *)                     echo "$PROMPT" ;;
  esac
}

# ── Phase runners ─────────────────────────────────────────────
run_agent_phase() {
  local phase="$1"
  local provider
  provider="$(resolve_provider "$phase")"

  header "$(phase_title "$phase")"
  echo "  Provider : $provider"
  echo ""

  # Build phase-specific prompt
  local phase_prompt
  phase_prompt="$(build_phase_prompt "$phase")"

  # Special case: PS phase with no file → just warn and skip
  if [ "$phase" = "ps" ] && echo "$phase_prompt" | grep -q "No PS-\*.md found"; then
    warn "$phase_prompt"
    return 0
  fi

  # ── Design phase ─────────────────────────────────────────────
  # Default: claude → fallback codex
  # Override with: --provider=codex | --provider=gemini | --provider=opencode
  if [ "$phase" = "design" ]; then
    local design_provider="${PROVIDER_OVERRIDE:-${DESIGN_PROVIDER:-claude}}"

    # Gemini path (opt-in via --provider=gemini or DESIGN_PROVIDER=gemini)
    if [ "$design_provider" = "gemini" ]; then
      header "$(phase_title "$phase")"
      echo "  Provider : gemini (Design like a senior web product designer)"
      echo ""
      if [ -z "${GEMINI_API_KEY:-}" ]; then
        warn "GEMINI_API_KEY not set — falling back to claude"
        design_provider="claude"
      else
        if [ -n "$PROMPT" ]; then
          python3 scripts/gemini_design_runner.py --feature "$PROMPT"
        else
          python3 scripts/gemini_design_runner.py
        fi
        local rc=$?
        [ $rc -ne 0 ] && warn "Gemini Design Agent failed — falling back to claude"
        if [ $rc -ne 0 ]; then
          design_provider="claude"
        else
          echo -e "${GREEN}  Specs saved to docs/design/screens/*/spec.md${NC}"
          return 0
        fi
      fi
    fi

    # claude / codex / opencode path
    header "$(phase_title "$phase")"
    echo "  Provider : $design_provider (fallback chain: claude → codex)"
    echo ""
    python3 scripts/agent_runner.py \
      --role "design" \
      --provider "$design_provider" \
      --prompt "$phase_prompt"
    return $?
  fi

  python3 scripts/agent_runner.py \
    --role "$phase" \
    --provider "$provider" \
    --prompt "$phase_prompt"
}

run_local_tasks_phase() {
  header "$(phase_title "local_tasks")"
  local script="scripts/run_local_tasks.py"
  if [ -f "$script" ]; then
    python3 "$script"
  else
    warn "$script not found — skipping."
  fi
}

run_phase() {
  case "$1" in
    local_tasks) run_local_tasks_phase ;;
    *)           run_agent_phase "$1" ;;
  esac
  return $?
}

# ── Main ──────────────────────────────────────────────────────
echo ""
echo "  SDLC Agent — Orchestrator"
echo "  Command  : $CMD"
echo "  Feature  : ${PROMPT:-none}"
echo "  Provider : ${PROVIDER_OVERRIDE:-auto (per-phase config)}"
echo "  Profile  : ${MODE_OVERRIDE:-${AI_PROFILE:-balanced}}"
echo "  Only     : ${ONLY:-all phases}"
echo "  From     : ${FROM:-start}"
echo "  Skip     : ${SKIP:-none}"
echo ""

resolve_initial_phases
apply_only
apply_from
apply_skip

if [ "${#PHASES[@]}" -eq 0 ]; then
  warn "No phases to run after applying filters."
  exit 0
fi

# ── Pre-flight: resolve feature name → REQ id ─────────────────
# Only run for feature/implement pipelines when PROMPT looks like
# a plain text name (not already a REQ-xxx or TASK-xxx).
if [[ "$CMD" == "/feature" || "$CMD" == "/implement" || "$CMD" == "/implementation" ]]; then
  if [[ -n "$PROMPT" ]] && ! echo "$PROMPT" | grep -qE "^(REQ|TASK|US)-[0-9]+"; then
    echo "  Pre-flight  : Resolving feature name → REQ id..."
    RESOLVED=$(python3 - "$PROMPT" <<'PYEOF'
import sys, re
from pathlib import Path
ROOT = Path.cwd()
feature_name = " ".join(sys.argv[1:])
req_dir = ROOT / "docs" / "requirements"
if not req_dir.exists():
    print("  ⚠ No docs/requirements/ directory found")
    sys.exit(0)
stop_words = {"a","an","the","and","or","for","with","in","of","to","is","that"}
feature_words = set(re.sub(r"[^a-z0-9 ]"," ", feature_name.lower()).split()) - stop_words
best_req, best_score = "", 0
for f in sorted(req_dir.glob("REQ-*.md")):
    content = f.read_text(errors="ignore")
    title_m = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    id_m = re.search(r"^id\s*:\s*(REQ-\d+)", content, re.MULTILINE|re.IGNORECASE)
    if not id_m: continue
    title = re.sub(r"REQ-\d+\s*[—\-]\s*","", title_m.group(1) if title_m else "", flags=re.IGNORECASE)
    title_words = set(re.sub(r"[^a-z0-9 ]"," ", title.lower()).split()) - stop_words
    overlap = len(feature_words & title_words)
    if overlap > best_score:
        best_score = overlap
        best_req = id_m.group(1).upper()
if best_score >= 2:
    print(f"  ✓ Matched: '{feature_name}' → {best_req}")
else:
    print(f"  ⚠ No REQ match for '{feature_name}' (will create new or search manually)")
PYEOF
)
    echo "$RESOLVED"
    echo ""
  fi
fi

echo "  Running  : ${PHASES[*]}"
echo ""

# ── Phase status tracking ─────────────────────────────────────
# Written to output/run-status/{PROMPT}.json so project_runner
# knows which phase failed and which US to mark blocked.
STATUS_DIR="output/run-status"
mkdir -p "$STATUS_DIR"
STATUS_FILE="$STATUS_DIR/$(echo "${PROMPT:-unknown}" | tr '/' '-' | tr ' ' '_').json"
FAILED_PHASE=""
PHASE_RESULTS="{}"

# Critical phases — stop the pipeline on failure
is_critical_phase() {
  case "$1" in
    implementation|qa) return 0 ;;
    *) return 1 ;;
  esac
}

for phase in "${PHASES[@]}"; do
  run_phase "$phase"
  rc=$?
  PHASE_RESULTS=$(printf '%s' "$PHASE_RESULTS" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
d['$phase'] = $rc
print(json.dumps(d))
" 2>/dev/null || echo "$PHASE_RESULTS")

  if [ $rc -ne 0 ]; then
    err "Phase '$phase' failed (exit $rc)"
    FAILED_PHASE="$phase"
    # Write failure record before stopping
    printf '{"prompt":"%s","failed_phase":"%s","exit_code":%d,"phase_results":%s}\n' \
      "${PROMPT:-}" "$phase" "$rc" "$PHASE_RESULTS" > "$STATUS_FILE"
    if is_critical_phase "$phase"; then
      err "Critical phase failed — pipeline stopped."
      err "Fix the issue then retry: ./scripts/run.sh /feature retry ${PROMPT:-}"
      exit $rc
    fi
  fi
done

# Write success or partial-failure record
printf '{"prompt":"%s","failed_phase":"%s","exit_code":0,"phase_results":%s}\n' \
  "${PROMPT:-}" "${FAILED_PHASE:-}" "$PHASE_RESULTS" > "$STATUS_FILE"

if [ -n "$FAILED_PHASE" ]; then
  warn "Orchestration finished with non-critical failures. Check: $STATUS_FILE"
else
  done_msg "Orchestration complete."
fi
