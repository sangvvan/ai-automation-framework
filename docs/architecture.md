# Architecture

This document describes how the modules fit together. For the **why**
behind each major decision, read the ADRs in `docs/decisions/`.

---

## 1. Module map

```
ai-test (CLI)              ─┐
                            │
       ┌────────────────────┴────────────────────┐
       │            Orchestrator                 │
       │     app/lib/cli/commands/run.ts         │
       └────────────────────┬────────────────────┘
                            │
   ┌──────────────┬─────────┴────────┬────────────────┬──────────────┐
   ▼              ▼                  ▼                ▼              ▼
PageAnalyzer  Test-Case Parser    Test Design     Scenario       Validator
analyzer/     scenario/parse +    Agent           Runner         validator/
              step-mapper         ai/agents/      runner/        validate.ts
                                  test-design.ts  runner.ts
                            │
       ┌────────────────────┴────────────────────┐
       │             Reporters                   │
       │  reporter/json.ts + reporter/html.ts    │
       └────────────────────┬────────────────────┘
                            │
                            ▼
                 reports/  +  Postgres
                            │
                            ▼
                  Review Web UI (Remix)
                  app/routes/auth.* + runs.*
```

Each module is documented at the top of its `index` or main file; this
section captures the high-level data flow.

---

## 2. Data flow per run

```
1. CLI parses argv → ParsedArgs.
2. loadConfig() merges configs/*.yaml + AI_TEST_* env → FrameworkConfig.
3. analyzePage(url) → PageAnalysis JSON (forms, semantic locators,
   sensitive-field flags). Writes page.png to evidence dir.
4. Scenarios:
   - testcase mode → parseTestCaseFile(file) + mapStepsToActions(analysis)
     produces ExecutableScenario[] (unresolved steps get warnings).
   - explore mode → buildProvider(role=design) gives a chained AiProvider;
     designScenarios({analysis,...}) returns ExecutableScenario[]; every
     step is grounded on a real PageAnalysis element.
5. runScenarios(scenarios) → ScenarioResult[] (per-scenario context,
   trace.zip, screenshots, console messages).
6. validateScenarioResult(result, expected) → ValidationResult per scenario
   (checks[], failureReason, suggestedDefect).
7. writeJsonReport + writeHtmlReport → masked report files.
8. persistRun(summary) → runs + scenarios rows in Postgres.
9. Exit code = (failed > 0 ? 1 : 0).
```

---

## 3. Configuration precedence

```
defaults baked into FrameworkConfig Zod schema
  ↓ overridden by
configs/framework.config.yaml + configs/test-env.yaml + configs/ai-provider.yaml
  ↓ overridden by
AI_TEST_* env vars (only path that reads process.env: app/lib/config.ts)
```

---

## 4. AI provider abstraction

Every AI call goes through `AiProvider.generateStructured<T>(input)`
which **must** receive a Zod schema. The chained provider in
`app/lib/ai/resolve.ts` walks the fallback chain (per
`configs/ai-provider.yaml`), logging every attempt to
`reports/evidence/{run-id}/ai-trace.jsonl`.

This means:

- Tests use `MockProvider` (fixtures pushed up-front).
- Production swaps adapters via configuration alone — no code change.
- Schema mismatches throw `ProviderError` with the model's response in
  the trace, so the chain falls back to the next provider.

---

## 5. Locator strategy

Resolution priority (`app/lib/runner/resolver.ts`):

1. `byRole(role, { name })`
2. `byLabel(text)`
3. `byText(text)`
4. `byTestId(value)`

Banned: CSS classes, `nth-child`, XPath, `page.waitForTimeout`. Lint /
review must reject these. Only files under `app/lib/runner/keywords/`
may construct Playwright locators directly.

---

## 6. Database schema

See `docs/decisions/ADR-004-db-schema.md`. The DB persists only:

- Auth state (`users`, `sessions`).
- Run metadata + scenario review state (`runs`, `scenarios`).
- An append-only `audit_log`.

Test artefacts (screenshots, traces, JSON reports, HTML reports) live on
disk under `reports/` and are referenced by path from DB rows — keeping
the DB small and the artefacts easy to archive or ship.

---

## 7. Review state machine

```
generated (ai-generated)            pending_review
                          │
                          ├── approve  ─► approved   (+ tests/approved/*.yaml)
                          │                  │
                          │                  ├── promote (test-lead) ─► in_regression=true
                          │                  │                        (+ tests/regression/*.yaml)
                          │                  │
                          │                  └── (re-open: test-lead only)
                          │
                          └── reject (reason ≥10) ─► rejected
```

Every state change writes a row to `audit_log` inside the same
transaction as the state mutation.

---

## 8. Universal-web pipeline (SPRINT-004)

```
ai-test crawl ──► Crawler (BFS, robots, rate-limit, route-pattern collapse)
                  → reports/sitemaps/{id}.json + DB crawls row

ai-test auth detect ──► detect-login (heuristic) → draft AuthRecipe YAML
ai-test auth login  ──► execute-auth (Playwright) → storage-state.json (0600)

ai-test run --site-map ──► orchestrate-sitemap iterates pages
                  per page: PageAnalysis → designScenarios →
                  runScenarios → validate → aggregate → RunSummary.
```

## 9. ISTQB & non-functional layer (SPRINT-005)

```
                            RunSummary
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
   TestPlan generator    JUnit reporter     HTML reporter
   (ADR-008)             (suite grouping)   (+technique coverage,
                                             +level pill)

Per-scenario post-checks (ADR-009):
   axe-core   ─► accessibilityViolations[]
   web-vitals ─► webVitals { lcpMs, cls, inpMs, ttfbMs }
   security   ─► securityChecks[]

Wait strategies (REQ-014):
   wait_for(strategy: visible | network-idle | mutation-stable | route-change)
```

ISTQB design techniques (REQ-012): the Test Design Agent loops over
`requestedTechniques` (CLI `--techniques`, default 7), appends the
matching prompt addendum, and tags every scenario with its technique.

## 10. Testing the framework itself

- **Vitest unit tests** colocated next to source (`*.test.ts`).
- **Playwright integration**: the fixture app (`tests/fixtures/sample-app/`)
  is a tiny static site with `login.html` and `search.html` that the CI
  smoke job drives through `ai-test run`.
- The CI workflow runs Vitest with coverage against a real Postgres
  service and a Chromium Playwright install — no mocks across the
  framework/system boundary.
