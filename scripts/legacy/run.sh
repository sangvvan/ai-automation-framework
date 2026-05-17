#!/usr/bin/env bash
# scripts/run.sh — SDLC Agent command palette
#
# Usage:
#   ./scripts/run.sh /feature "Browse product catalog"
#   ./scripts/run.sh /implement TASK-001
#   ./scripts/run.sh /implement TASK-001 --provider=claude
#   ./scripts/run.sh /systemtest "Browse product catalog"
#   ./scripts/run.sh /feature "..." --skip=qa,devops
#   ./scripts/run.sh /feature "..." --from=design
#   ./scripts/run.sh /help

set +e

source .agent/config/agent.config 2>/dev/null || true

DATE=$(date +%Y-%m-%d)
CMD="${1:-}"
shift || true

# ── Parse args ────────────────────────────────────────────────
PROMPT=""
PROVIDER=""
MODE=""
ONLY=""
FROM=""
SKIP=""
PARALLEL=""
AUTOFIX=""
IGNORE_BLOCKED=""
MAX_RETRIES=""

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --provider=*)      PROVIDER="${1#*=}" ;;
    --mode=*)          MODE="${1#*=}" ;;
    --only=*)          ONLY="${1#*=}" ;;
    --from=*)          FROM="${1#*=}" ;;
    --skip=*)          SKIP="${1#*=}" ;;
    --parallel)        PARALLEL="true" ;;
    --autofix)         AUTOFIX="true" ;;
    --ignore-blocked)  IGNORE_BLOCKED="true" ;;
    --max-retries=*)   MAX_RETRIES="${1#*=}" ;;
    skip=*)            SKIP="${1#*=}" ;;
    from=*)            FROM="${1#*=}" ;;
    only=*)            ONLY="${1#*=}" ;;
    *)                 PROMPT="$PROMPT $1" ;;
  esac
  shift
done
PROMPT="$(echo "$PROMPT" | xargs)"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
header()   { echo -e "\n${BLUE}▶ $1${NC}\n"; }
done_msg() { echo -e "\n${GREEN}✓ $1${NC}\n"; }
warn()     { echo -e "\n${YELLOW}⚠ $1${NC}\n"; }

# ── Quick agent call (for non-pipeline commands) ──────────────
run_agent() {
  local role="$1"
  local body="$2"
  local pfile
  pfile="$(mktemp)"
  printf '%s' "$body" > "$pfile"
  python3 scripts/agent_runner.py \
    --role "$role" \
    --prompt-file "$pfile" \
    ${PROVIDER:+--provider "$PROVIDER"} \
    ${MODE:+--mode "$MODE"}
  local rc=$?
  rm -f "$pfile"
  return $rc
}

# ── Pipeline call (delegates to orchestrate.sh) ───────────────
run_pipeline() {
  bash scripts/orchestrate.sh \
    "$CMD" "$PROMPT" "$PROVIDER" "$MODE" "$ONLY" "$FROM" "$SKIP"
}

# ── Help ──────────────────────────────────────────────────────
if [ -z "$CMD" ] || [ "$CMD" = "/help" ]; then
  echo ""
  echo "  SDLC Agent — Command Palette"
  echo "  ──────────────────────────────────────────────────────"
  echo "  Full workflow (recommended entry points)"
  echo "    /feature REQ-001           Full pipeline for one requirement"
  echo "    /feature all               Full pipeline for ALL requirements (sequential)"
  echo "    /feature all --parallel    Full pipeline for ALL requirements (parallel)"
  echo "    /feature retry REQ-001     Re-run only blocked/todo stories, resume from failed phase"
  echo "    /feature retry             Re-run all requirements that have blocked stories"
  echo "    /project status            Project dashboard: done/todo/bugs/sprints"
  echo "    /project triage            Re-triage incomplete US into sprint files"
  echo ""
  echo "  After /feature all: sprint files are auto-created. Then:"
  echo "    /sprint start SPRINT-001   Run sprint pipeline for that sprint's stories"
  echo ""
  echo "  Individual phases (advanced)"
  echo "    /ps       \"feature\"            Phase 0: PS → Requirements"
  echo "    /ba       \"description\"        Phase 1: Requirements + User Stories"
  echo "    /advisor  \"description\"        Phase 2: LLM routing review"
  echo "    /planning \"description\"        Phase 3: Tasks + technical plan  (/architect alias works too)"
  echo "    /design   \"description|US-id\"  Phase 4: UI/UX specs + mockups"
  echo "    /implement TASK-001            Phase 5: Implement one task"
  echo "    /qa       \"description|US-id\"  Phase 7: Tests + validation"
  echo "    /devops   \"description\"        Phase 8: CI/CD + PR"
  echo ""
  echo "  Scrum sprint"
  echo "    /sprint plan                             List sprints (auto-created by /planning)"
  echo "    /sprint plan  [SPRINT-id] US-001 US-002  Manually create/override a sprint"
  echo "    /sprint start SPRINT-001                 Run full pipeline for every US in sprint"
  echo "    /sprint status [SPRINT-id]               Show current sprint progress"
  echo "    /sprint report [SPRINT-id]               Generate sprint report"
  echo "    /sprint retro  [SPRINT-id]               Run retrospective (Scrum agent)"
  echo ""
  echo "  Actions"
  echo "    /fix      BUG-001|\"description\" Quick targeted fix"
  echo "    /req      \"new requirement\"    Add/update requirement"
  echo "    /test     US-001|TASK-001|all  Run tests"
  echo "    /systemtest US-001|TASK-001|all Real E2E system test"
  echo "    /performance US-001|TASK-001|all Performance tests only"
  echo "    /security US-001|TASK-001|all Security tests only"
  echo "    /review   <pr> [merge]         Review PR"
  echo "    /deploy   local|staging|prod   Deploy"
  echo "    /status                        Show provider config"
  echo "    /retro                         Retrospective"
  echo "    /release  v1.0.0               Release notes"
  echo ""
  echo "  Flags"
  echo "    --provider=claude|codex|copilot|gemini|opencode|opencode-ollama"
  echo "    --mode=premium|balanced|local"
  echo "    --parallel                     Run all requirements in parallel"
  echo "    --skip=qa,devops               Skip phases"
  echo "    --from=design                  Resume from phase"
  echo ""
  echo "  Blocker flags (for /feature run)"
  echo "    --autofix                      Auto-run Fix Agent + retry on any blocker (no human prompt)"
  echo "    --ignore-blocked               Skip blocked stories, create BUG files, continue"
  echo "    (default: interactive — pause and ask [A]utofix / [S]kip / [Q]uit per blocker)"
  echo "    --max-retries=N                Max autofix attempts per requirement (default 2)"
  echo ""
  exit 0
fi

# ── Pipeline commands ─────────────────────────────────────────
case "$CMD" in
  # ── Feature: full pipeline, one or all requirements ──────────
  /feature)
    if [ -z "$PROMPT" ]; then
      echo "Usage: ./scripts/run.sh /feature REQ-001"
      echo "       ./scripts/run.sh /feature all"
      echo "       ./scripts/run.sh /feature all --parallel"
      exit 1
    fi
    # /feature retry [REQ-id] — special subcommand
    FEATURE_SUB="$(echo "$PROMPT" | awk '{print $1}')"
    FEATURE_ARG="$(echo "$PROMPT" | awk '{$1=""; print $0}' | xargs)"
    if [ "$FEATURE_SUB" = "retry" ]; then
      header "/feature retry: ${FEATURE_ARG:-all blocked}"
      python3 scripts/project_runner.py retry "$FEATURE_ARG" \
        ${PROVIDER:+--provider "$PROVIDER"} \
        ${SKIP:+--skip "$SKIP"} \
        ${MAX_RETRIES:+--max-retries "$MAX_RETRIES"}
      done_msg "/feature retry complete."
    else
      header "/feature: $PROMPT"
      python3 scripts/project_runner.py run "$PROMPT" \
        ${PROVIDER:+--provider "$PROVIDER"} \
        ${PARALLEL:+--parallel} \
        ${AUTOFIX:+--autofix} \
        ${IGNORE_BLOCKED:+--ignore-blocked} \
        ${SKIP:+--skip "$SKIP"} \
        ${FROM:+--from "$FROM"} \
        ${MAX_RETRIES:+--max-retries "$MAX_RETRIES"}
      done_msg "/feature $PROMPT complete."
    fi
    ;;

  # ── Project: status dashboard and triage ─────────────────────
  /project)
    SUB="${PROMPT:-status}"
    header "/project $SUB"
    python3 scripts/project_runner.py "$SUB"
    done_msg "/project $SUB complete."
    ;;

  # ── Individual phases (advanced use) ─────────────────────────
  /ps|/problem|\
  /ba|/advisor|/planning|/architect|/design|\
  /implement|/implementation|\
  /qa|/devops)
    [ -z "$PROMPT" ] && echo "Usage: ./scripts/run.sh $CMD \"description or ID\"" && exit 1
    header "$CMD: $PROMPT"
    run_pipeline
    done_msg "$CMD complete."
    ;;

  # ── Fix ─────────────────────────────────────────────────────
  /fix)
    [ -z "$PROMPT" ] && echo "Usage: ./scripts/run.sh /fix BUG-001 or \"description\"" && exit 1
    header "/fix: $PROMPT"
    BRANCH="fix/$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]' | sed 's/ /-/g' | cut -c1-40)"
    git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"
    run_agent "implementation" "You are the Fix Agent.

BUG: $PROMPT

RULES:
- If starts with BUG-, find the bug record in docs/.
- Find the root cause by reading relevant source files.
- Fix with minimal targeted change — do not refactor unrelated code.
- Add or update a unit test that catches this exact bug.
- Commit: fix: $PROMPT
- Output a concise fix summary: root cause, files changed, test added."
    git push -u origin "$BRANCH" 2>/dev/null || true
    gh pr create --title "fix: $PROMPT" \
      --body "**Bug**: $PROMPT
**Date**: $DATE
**Type**: Targeted fix

- [ ] Root cause identified
- [ ] Minimal fix applied
- [ ] Unit test added
- [ ] No regressions" \
      --base develop --label "bugfix,ai-generated" 2>/dev/null || true
    done_msg "Fix PR opened."
    ;;

  # ── Req ─────────────────────────────────────────────────────
  /req)
    [ -z "$PROMPT" ] && echo "Usage: ./scripts/run.sh /req \"requirement text\"" && exit 1
    header "/req: $PROMPT"
    run_agent "ba" "New requirement request: \"$PROMPT\"
Date: $DATE

1. Check if this extends an existing REQ or is brand new.
   - Extends existing: create REQ-{id}-v2.md superseding the old one.
   - New: create REQ-{n}.md with next available number.
2. Update/create related User Stories if needed.
3. Update docs/traceability.md.

Output:
## Requirement Summary
Action: (created NEW REQ-{n} | created REQ-{id}-v2 superseding REQ-{id})
Files: (list)"
    done_msg "Requirement documented."
    ;;

  # ── System Test / E2E ───────────────────────────────────────────
  /systemtest|/e2e)
    TARGET="${PROMPT:-all}"
    header "/systemtest: $TARGET"
    python3 scripts/systemtest_runner.py \
      "$TARGET" \
      ${MODE:+--mode "$MODE"}
    done_msg "System test flow complete."
    ;;

  /performance)
    TARGET="${PROMPT:-all}"
    header "/performance: $TARGET"
    python3 scripts/systemtest_runner.py \
      "$TARGET" \
      --mode performance
    done_msg "Performance test flow complete."
    ;;

  /security)
    TARGET="${PROMPT:-all}"
    header "/security: $TARGET"
    python3 scripts/systemtest_runner.py \
      "$TARGET" \
      --mode security
    done_msg "Security test flow complete."
    ;;
  
  # ── Test ────────────────────────────────────────────────────
  /test)
    TARGET="${PROMPT:-all}"
    header "/test: $TARGET"
    run_agent "qa" "QA TARGET: $TARGET

- If US-id: test that story's acceptance criteria only.
- If TASK-id: test that task's implementation scope only.
- If 'all': run all available tests.

Run tests if infra exists:
  Backend : python3 -m pytest --tb=short 2>&1 | tail -30
  Web     : npm test 2>&1 | tail -30
  iOS     : xcodebuild test 2>&1 | tail -30

Fix failing tests. Re-run to confirm.

Output:
## Test Report
| Test | Result | Notes |
Summary: X passed / Y failed / Z skipped"
    done_msg "Tests complete."
    ;;

  # ── Review ──────────────────────────────────────────────────
  /review)
    PR="${PROMPT%% *}"
    ACTION="${PROMPT#* }"
    [ -z "$PR" ] && echo "Usage: ./scripts/run.sh /review <pr-number> [merge]" && exit 1
    header "/review: PR #$PR"
    DIFF=$(gh pr diff "$PR" 2>/dev/null || echo "(gh not configured)")
    TITLE=$(gh pr view "$PR" --json title -q .title 2>/dev/null || echo "PR #$PR")
    run_agent "review" "Review PR #$PR: $TITLE

Diff:
$DIFF

Review criteria:
1. Conventions match CLAUDE.md
2. Architecture: correct layer separation
3. Security: no hardcoded secrets, payment/auth handled correctly
4. Tests: new code has tests, ACs covered
5. Docs: traceability updated, task status = done

Output:
## PR Review #$PR
### Verdict
APPROVE | REQUEST CHANGES

### Summary
(2 sentences max)

### Issues
(file:line — description, or None)

### Suggestions
(optional, non-blocking)"

    if echo "$ACTION" | grep -q "merge"; then
      if gh pr view "$PR" --json state -q .state 2>/dev/null | grep -q "OPEN"; then
        gh pr merge "$PR" --squash --delete-branch
        done_msg "PR #$PR merged."
      fi
    fi
    done_msg "Review complete."
    ;;

  # ── Deploy ──────────────────────────────────────────────────
  /deploy)
    [ -z "$PROMPT" ] && echo "Usage: ./scripts/run.sh /deploy local|staging|production [aws|azure|vercel]" && exit 1
    T="${PROMPT%% *}"
    P="${PROMPT#* }"
    [ "$T" = "$P" ] && P=""
    header "/deploy: $T ${P:+($P)}"
    bash scripts/deploy.sh "$T" "$P"
    done_msg "Deploy complete."
    ;;

  # ── Status ──────────────────────────────────────────────────
  /status)
    header "/status"
    echo "  PLATFORM          : ${PLATFORM:-}"
    echo "  PROJECT_TYPE      : ${PROJECT_TYPE:-}"
    echo "  AI_PROFILE        : ${AI_PROFILE:-}"
    echo "  ──────────────────────────────────────"
    echo "  PREMIUM_PROVIDER  : ${PREMIUM_PROVIDER:-}"
    echo "  BALANCED_PROVIDER : ${BALANCED_PROVIDER:-}"
    echo "  LOCAL_PROVIDER    : ${LOCAL_PROVIDER:-}"
    echo "  ──────────────────────────────────────"
    echo "  PS_PROVIDER       : ${PS_PROVIDER:-}"
    echo "  BA_PROVIDER       : ${BA_PROVIDER:-}"
    echo "  ADVISOR_PROVIDER  : ${ADVISOR_PROVIDER:-}"
    echo "  PLANNING_PROVIDER : ${PLANNING_PROVIDER:-${ARCHITECT_PROVIDER:-}}"
    echo "  DESIGN_PROVIDER   : ${DESIGN_PROVIDER:-}"
    echo "  IMPLEMENT_PROVIDER: ${IMPLEMENT_PROVIDER:-}"
    echo "  QA_PROVIDER       : ${QA_PROVIDER:-}"
    echo "  DEVOPS_PROVIDER   : ${DEVOPS_PROVIDER:-}"
    echo "  SCRUM_PROVIDER    : ${SCRUM_PROVIDER:-}"
    echo "  ──────────────────────────────────────"
    echo "  Fallback chains"
    echo "  CLAUDE_FALLBACK   : ${CLAUDE_FALLBACK:-codex}"
    echo "  CODEX_FALLBACK    : ${CODEX_FALLBACK:-opencode}"
    echo "  OPENCODE_FALLBACK : ${OPENCODE_FALLBACK:-opencode-ollama}"
    echo "  ──────────────────────────────────────"
    echo "  LM Studio"
    echo "  LOCAL_MODEL       : ${LOCAL_MODEL:-}"
    echo "  LOCAL_API_URL     : ${LOCAL_API_URL:-}"
    echo "  LOCAL_MAX_PROMPT_TOKENS: ${LOCAL_MAX_PROMPT_TOKENS:-15000}"
    echo "  ──────────────────────────────────────"
    echo "  Ollama"
    echo "  OLLAMA_MODEL      : ${OLLAMA_MODEL:-}"
    echo "  OLLAMA_API_URL    : ${OLLAMA_API_URL:-}"
    echo "  OLLAMA_MAX_PROMPT_TOKENS: ${OLLAMA_MAX_PROMPT_TOKENS:-15000}"
    echo "  DESIGN_MODE       : ${DESIGN_MODE:-}"
    echo "  AUTO_COMMIT       : ${AUTO_COMMIT:-}"
    echo "  AUTO_MERGE        : ${AUTO_MERGE:-}"
    echo ""
    echo "  Open PRs:"
    gh pr list --state open 2>/dev/null || echo "  (gh not configured)"
    echo ""
    echo "  Tasks:"
    TODO=$(find docs/tasks -name "*.md" -exec grep -l "status.*: todo" {} \; 2>/dev/null | wc -l | tr -d ' ')
    DONE=$(find docs/tasks -name "*.md" -exec grep -l "status.*: done" {} \; 2>/dev/null | wc -l | tr -d ' ')
    echo "  todo: $TODO  done: $DONE"
    done_msg "Status printed."
    ;;

  # ── Retro ───────────────────────────────────────────────────
  /retro)
    header "/retro"
    run_agent "review" "Generate a sprint retrospective from the current repo state.
Read docs/traceability.md and output/reports/ if available.
Include: what shipped, metrics (tasks local vs cloud), patterns, recommendations.
Save to output/reports/retro-${DATE}.md"
    done_msg "Retrospective saved."
    ;;

  # ── Release ─────────────────────────────────────────────────
  /release)
    [ -z "$PROMPT" ] && echo "Usage: ./scripts/run.sh /release v1.0.0" && exit 1
    header "/release: $PROMPT"
    run_agent "devops" "Prepare release $PROMPT.
Read docs/traceability.md and output/reports/.
Create docs/releases/${PROMPT}.md with:
- What's new (features by REQ)
- Bug fixes
- Technical notes (migrations, API changes)
- Stats (tasks completed, local vs cloud)
Tag and push: git tag -a $PROMPT -m 'Release $PROMPT' && git push origin $PROMPT"
    done_msg "Release $PROMPT done."
    ;;

  # ── Sprint ──────────────────────────────────────────────────
  /sprint)
    SUB="${PROMPT%% *}"
    REST="${PROMPT#* }"
    [ "$SUB" = "$REST" ] && REST=""
    if [ -z "$SUB" ]; then
      echo "Usage: ./scripts/run.sh /sprint plan|start|status|report|retro [args]"
      exit 1
    fi
    header "/sprint $SUB: $REST"
    # Build args array for sprint_runner.py
    SPRINT_ARGS=("$SUB")
    # Append positional tokens from REST
    if [ -n "$REST" ]; then
      # shellcheck disable=SC2206
      read -ra _REST_TOKENS <<< "$REST"
      for _t in "${_REST_TOKENS[@]}"; do
        SPRINT_ARGS+=("$_t")
      done
    fi
    python3 scripts/sprint_runner.py "${SPRINT_ARGS[@]}" \
      ${PROVIDER:+--provider "$PROVIDER"} \
      ${MODE:+--from "$MODE"} \
      ${FROM:+--from "$FROM"} \
      ${SKIP:+--skip "$SKIP"}
    done_msg "/sprint $SUB complete."
    ;;

  # ── Skill ───────────────────────────────────────────────────
  /skill)
    bash scripts/new-skill.sh "$PROMPT" "${PROVIDER:-}"
    ;;

  # ── Unknown ─────────────────────────────────────────────────
  *)
    warn "Unknown command: $CMD"
    echo "  Run ./scripts/run.sh /help"
    exit 1
    ;;
esac
