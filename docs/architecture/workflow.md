# Workflow Architecture — companion to ADR-012

> Operator-facing view of the `ai-test workflow` pipeline. Maps every
> phase to the modules that implement it, the artefacts it produces, the
> failure modes it handles, and the chart catalogue rendered in the
> final HTML report.

---

## 0. End-to-end diagram

```text
                              ┌──────────────────────────────┐
                              │   ai-test workflow CLI       │
                              │   --input project.yaml       │
                              └──────────────┬───────────────┘
                                             │ for each role:
                                             ▼
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────┐ ┌─────────┐
│   P0    │ │   P1    │ │   P2    │ │     P3       │ │     P4     │ │   P5     │ │   P6    │
│ Env     │→│ Data    │→│ Auth    │→│  Discover    │→│ Generate   │→│ Run +    │→│ Report  │
│ test    │ │ input   │ │ login   │ │  SiteMap     │ │ test cases │ │ validate │ │ + alert │
│ (pre-   │ │ (load   │ │ (opt.)  │ │  per role    │ │ per page   │ │ (matrix) │ │ (HTML/  │
│ flight) │ │  YAML)  │ │         │ │              │ │ (ISTQB 7)  │ │          │ │  JUnit/ │
│         │ │         │ │         │ │              │ │            │ │          │ │  Plan/  │
│         │ │         │ │         │ │              │ │            │ │          │ │  PR)    │
└─────────┘ └─────────┘ └─────────┘ └──────────────┘ └────────────┘ └──────────┘ └─────────┘
   stdout   WorkflowInput  storage-   reports/         tests/         RunSummary  reports/
   only     (Zod-typed)    state.json  sitemaps/        generated/    + per-step  html/
                           (0600)      C-*.json        *.yaml +       evidence    json/
                                       + DB row        manifest.json              junit/
                                                                                  test-plans/
                                                                                  coverage/
                                                                                  + DB rows
                                                                                  + PR comment
```

Each box is **idempotent given identical inputs**. Phase boundaries
are typed (Zod) so a phase can be swapped, mocked, or skipped without
breaking neighbours.

---

## 1. Phase-by-phase reference

### P0 — Environment Testing

| | |
|---|---|
| **Implements** | `app/lib/config.ts` (`loadConfig`, `getEnv`), planned: `app/lib/cli/preflight.ts` |
| **Inputs** | `.env`, `configs/*.yaml`, system PATH, optional `DATABASE_URL`, `GITHUB_TOKEN` |
| **Outputs** | Throws `ConfigError` / `Error` on missing required env; otherwise silent. |
| **Checks** | Node ≥20 · `FrameworkConfig` parse · `ai-provider.yaml` has ≥1 enabled provider · provider keys present · DB reachable (best-effort) |
| **Exit codes** | 0 OK · 2 misconfig |
| **Failure mode** | Fail-fast before any browser launch. |

ISTQB anchor: ISTQB CTFL §2.4 — "Test environment readiness" is an
entry-criterion in the Test Plan.

---

### P1 — Data Input

| | |
|---|---|
| **Implements** | `app/lib/workflow/config.ts` (`readWorkflowInput`, `WorkflowInput`) |
| **Inputs** | `--input <project>.yaml` (path) |
| **Outputs** | `WorkflowInput` in memory (Zod-validated) |
| **Schema (high level)** | `project, baseUrl, roles[], crawl, generation, run` — see ADR-012 §2 for the full surface |
| **Secrets** | Only `${ENV_VAR}` placeholders inside auth recipes (resolved later in P2) |
| **Failure mode** | `WorkflowConfigError` with the failing field path; exit 2 |

Example `inputs/projects/<my-app>.yaml` (excerpt):

```yaml
project: shop
baseUrl: https://staging.shop.example.com
roles:
  - name: anonymous
  - name: customer
    authRecipe: inputs/auth/shop-customer.yaml
  - name: admin
    authRecipe: inputs/auth/shop-admin.yaml
crawl:
  maxPages: 50
  maxDepth: 4
  perHostQps: 2
generation:
  maxScenariosPerPage: 14    # 2 per technique × 7 techniques
  fallbackSmoke: true
run:
  testLevel: system
  browsers: [chromium, firefox]
  locales: [en, vi]
  nonFunctional:
    a11y: true
    a11yFailOn: [serious, critical]
    vitals: true
    securityHeaders: true
  junit: true
  testPlan: true
  persistDefects: true
  prComment: true
```

---

### P2 — Auth Login (optional, per role)

| | |
|---|---|
| **Implements** | `app/lib/auth/recipe-loader.ts`, `app/lib/auth/execute-auth.ts`, `app/lib/auth/detect-login.ts`, `app/lib/auth/storage-state.ts` |
| **Inputs** | `role.authRecipe` (YAML), env vars |
| **Outputs** | `reports/auth/<project>/<role>.storage-state.json` (mode 0600) |
| **DSL** | See ADR-007 — `AuthRecipe { id, loginUrl, fields{username,password,extras[]}, submit, postLogin{waitFor[], urlContains, textContains}, expectsCaptcha, sessionLifetimeMinutes }` |
| **Failure modes** | `AuthConfigError` (missing env), `AuthError` (wrong creds / post-login check failed) |
| **Re-login** | `AuthExpiredError` class is reserved; actual mid-run re-login is **not yet wired** — runner sees expired sessions as element-not-found and fails scenarios. Sprint 7 follow-up: re-execute recipe when post-navigation URL matches `loginUrl` and retry the scenario once. |
| **Anti-leak** | Secrets never logged; storage-state ignored by git; recipe excluded from `tests/approved/` |

ISTQB anchor: "test data preparation" / "test environment setup" —
the per-role storage state is the data that allows the rest of the
pipeline to exercise authenticated paths.

---

### P3 — Discover SiteMap (per role)

| | |
|---|---|
| **Implements** | `app/lib/crawler/{discover,normalize,robots,rate-limiter,route-pattern}.ts` |
| **Inputs** | `baseUrl`, `crawl` config, `storageStatePath` from P2 |
| **Outputs** | `reports/sitemaps/C-<id>.json` + `crawls` DB row |
| **Policy** | Bounded BFS · same-origin (opt-in subdomains) · robots.txt-aware · per-host token bucket · route-pattern collapse · `User-Agent: ai-test/<ver>` |
| **Schema** | `SiteMap { crawlId, entryUrl, startedAt, finishedAt, exitReason, totals, pages[], skipped[], config, storageStatePath? }` |
| **Per-page evidence** | `reports/evidence/<crawlId>/<page-hash>/` |
| **Exit reasons** | `done · maxPagesReached · maxDepthReached · timeoutReached · aborted` |
| **Failure mode** | Per-page fetch errors → `skipped[]` entry, crawl continues |

ISTQB anchor: "Test basis identification" — the SiteMap is the
inventory the rest of the test design hangs off.

---

### P4 — Generate Test Cases per Page (ISTQB)

| | |
|---|---|
| **Implements** | `app/lib/workflow/generate.ts` (orchestrator) + `app/lib/ai/agents/test-design.ts` (agent) + `app/lib/ai/prompts/techniques.ts` (8 addenda) |
| **Inputs** | `SiteMap` from P3, `generation.{maxScenariosPerPage, categories, fallbackSmoke}`, optional `requestedTechniques` |
| **Outputs** | `tests/generated/<project>/<role>/<page-slug>-<hash>.yaml` per page + `manifest.json` |
| **AI providers** | Chained: `claude → codex → opencode → mock` (per `configs/ai-provider.yaml`) |
| **ISTQB technique enforcement** | For every page with ≥1 input, agent loops over the 7 techniques (EP/BVA/DT/ST/UC/PW/EG); per-technique system-prompt addendum forces tagging |
| **Type coverage** | `functional` baseline; `a11y/perf/security/i18n/compat` added by the runner per-scenario via non-functional validators |
| **Schema grounding** | Every step must reference a locator present in the PageAnalysis (or `resolved: false` + warning) |
| **Anti-harvest** | Synthetic data only (faker-style generator, REQ-016); values that match observed page text are re-rolled |
| **Fallback** | `scenarios.length === 0` (Mock with no fixtures, all techniques skipped, etc.) → smoke `open_page + verify_url` |
| **Re-use** | The YAML output is the canonical re-run artefact; review-approve promotes to `tests/approved/`, test-lead promotes to `tests/regression/` |
| **Failure mode** | Per-page generation errors → `manifest.errors[]`, generation continues; budget exhaustion → `BudgetExceededError` halts P4 with partial outputs |

ISTQB coverage matrix (target):

| Technique | When the agent emits it | Tag |
|---|---|---|
| Equivalence Partitioning | every input → 1 scenario per partition | `equivalence-partition` |
| Boundary Value Analysis | min, min+1, max-1, max, ±1 outside | `boundary-value` |
| Decision Table | conditional rules (role/discount/visibility) | `decision-table` |
| State Transition | multi-step flows (signup/email-verify/onboard) | `state-transition` |
| Use-Case | end-to-end journey + alternate + exception path | `use-case` |
| Pairwise | enumerable factor combinations | `pairwise` |
| Error Guessing | catch-all heuristics (empty, very long, unicode, double click) | `error-guessing` |
| Exploratory Charter | time-boxed goal ("find ways to break X") | `exploratory-charter` |

---

### P5 — Run + Validate (matrix)

| | |
|---|---|
| **Implements** | `app/lib/workflow/run-suite.ts` (orchestrator) → `app/lib/runner/runner.ts` (per-scenario) → `app/lib/runner/keywords/*` (actions) → `app/lib/validator/{validate,checks/non-functional/*}.ts` |
| **Inputs** | `casesDir`, `siteMapPath` (optional), `storageStatePath`, `browsers[]`, `locales[]`, `nonFunctional` toggles |
| **Outputs** | `RunSummary` in memory + per-scenario evidence dir |
| **Matrix** | scenarios × browsers × locales — tagged ids when >1 browser/locale |
| **Stability** | semantic locators only (role > label > text > testId), `wait_for` strategies, optional self-heal, opt-in screenshot baselining |
| **Non-functional checks** | axe-core (post-scenario) · web-vitals (per page nav) · security headers (per response) · all flow into `ValidationCheck[]` with `category` |
| **Budget** | per-run AI token budget surfaced via chained provider; `BudgetExceededError` halts with partial summary |
| **Element coverage** | runner records every touched `PageElement.id`; aggregated for the report |

---

### P6 — Report

| | |
|---|---|
| **Implements** | `app/lib/reporter/{html,json,junit,test-plan-generator,mask,github-pr}.ts` |
| **Inputs** | `RunSummary`, optional previous `RunSummary` for same `suiteTag` |
| **Outputs (per run)** | `reports/test-plans/<runId>.json` · `reports/json/<runId>.json` · `reports/junit/<runId>.xml` · `reports/html/<runId>/index.html` · `reports/coverage/<runId>.json` · DB rows (`runs`, `scenarios`, `defects`, `audit_log`) · GitHub PR comment |
| **Self-contained** | HTML report has no CDN deps; SVG charts inlined; works offline |
| **Masking** | Sensitive fill values (password/token/secret/SSN/card/CVV) redacted as `***` everywhere — JSON, HTML, JUnit `<failure>` CDATA, descriptions |
| **Idempotent PR comment** | finds prior comment by hidden marker `<!-- ai-test:summary:<runId-prefix> -->` and PATCHes; otherwise POSTs |
| **Regression diff** | finds latest prior run with same `suiteTag`; surfaces new failures / newly passing / carried failures |

---

## 2. Chart catalogue (HTML report)

Every chart is a **server-rendered SVG string** — no client JS, no
CDN, no Chart.js. Tables are real `<table>` for accessibility + PDF
export.

### 2.1 Header strip
- **Overview donut** (SVG): pass / fail / skip three arcs sized by
  count; centre label = total. Width 120px so the strip fits four KPI
  cards beside it.
- **Test-level + mode pills** (existing) + ISTQB technique chips
  (REQ-012).
- **Suite tag** + run id + start/finish timestamps.

### 2.2 Quality coverage band (new in this enhancement)
- **Type-coverage chips**: one per `types[]` in TestPlan
  (functional / a11y / perf / security / compat / usability / i18n)
  with a colour-coded background derived from per-type pass rate.
- **ISTQB technique-coverage bar** (existing in Sprint 5): horizontal
  stacked bar of counts per technique with pass-rate label.
- **Browser × locale matrix** (new): table cells coloured by pass
  rate, scenarios as rows, `(browser, locale)` columns. Empty
  matrices (default chromium / no locale) collapse to a single column.

### 2.3 Failure panel
- **Failed scenarios list** (expandable rows existing): step-by-step
  result with screenshot thumbnails, failure reason, trace link.
- **Defects table** (new in Sprint 6): severity, status, copy-as-issue.

### 2.4 Non-functional panels
- **Web Vitals dials** (new): per-page LCP/CLS/INP/TTFB as four small
  half-donut gauges with green/amber/red thresholds.
- **Accessibility violations heatmap** (new): rows = WCAG level
  (A / AA / AAA), columns = impact (minor → critical); cell value =
  count.
- **Security checks table** (existing in `securityChecks[]`): header
  name, status, severity, hint.

### 2.5 Coverage panel
- **Element coverage heatmap** (new): row per analysed page, column
  per element kind (button / input / link / select / dialog). Cell
  shows touched/total + colour gradient.
- **Untested elements list** (drill-down): elements with `touched=0`,
  shown per page with their accessible name + locator so a reviewer
  can decide to add a scenario.
- **AC traceability map**: requirement id → test cases → defects, as
  a nested expandable list. Falls back to "(no AC summary)" when REQ
  files are not present in `docs/requirements/`.

### 2.6 Trend / regression
- **Regression diff banner** (existing in Sprint 6): amber band at
  top with counts + expandable lists; links to the previous run.
- **Sparkline of pass-rate** across last N runs with the same
  `suiteTag` (new; falls back to "no history" when fewer than 2 runs).

### 2.7 Plan + Trace
- **Test Plan tab** (existing in Sprint 5): the full TestPlan JSON
  rendered as readable HTML sections (scope, items, levels, types,
  approach, entry/exit, risks, schedule, resources, deliverables,
  traceability).
- **AI usage trace** (footer drawer, new): provider, role, attempt,
  tokens-in, tokens-out, cumulative — for cost audit.

> The "(new)" markers above are the ones we should add as Sprint 7
> follow-up if not already present. After this architecture is
> committed I will walk the codebase and either implement what's
> missing or document the gap.

---

## 3. Re-run / regression workflow

```text
First workflow run:
   ai-test workflow --input project.yaml
   → produces tests/generated/<project>/<role>/*.yaml
   → produces reports/.../R-1/*

Review:
   /runs/R-1/  (Remix UI)
   approve scenario → tests/approved/<feature>/<id>.yaml
   promote (test-lead) → tests/regression/<feature>/<id>.yaml

Re-run regression on demand:
   ai-test run-suite --cases-dir tests/regression/ \
     --suite-tag "shop-customer-regression" \
     --browsers chromium,firefox --locales en,vi \
     --a11y --vitals --security-headers
   → reuses YAML, no AI cost, deterministic
   → HTML report shows regression diff vs prior same-tag run
```

---

## 4. Failure-mode + exit-code matrix

| Failure | Exit | Phase |
|---|---|---|
| All scenarios passed | 0 | — |
| ≥1 scenario failed | 1 | P5 |
| Workflow / framework misconfig | 2 | P0 / P1 |
| Auth flow failed | 3 | P2 |
| Browser unreachable / target unreachable | 3 | P3 / P5 |
| Token budget exhausted mid-run | 4 | P4 / P5 (planned) |
| Internal orchestration error | 5 | any |

Status of each in code:

- 0/1 — already wired in `runCommand` + `runTestCaseSuite`.
- 2 — `loadConfig` throws on bad config; `readWorkflowInput` throws
  `WorkflowConfigError`. The workflow CLI maps both to non-zero exit
  but currently returns `2` only for orchestration errors. **Planned
  fix**: tighten `workflowCommand.run` to return 2 on
  `WorkflowConfigError`.
- 3 — `runAuthRecipe` returns `3` in the workflow CLI already.
- 4 — `BudgetExceededError` from the chained provider isn't yet
  mapped to a distinct exit code in the workflow command. **Planned
  fix**: catch it and return 4.
- 5 — uncaught errors fall through to the dispatcher's `process.exit(2)`
  default. **Planned fix**: dispatch-level distinction between
  "command threw" and "command returned a non-zero".

---

## 5. Open follow-ups (drives Sprint 7 backlog)

- Implement `app/lib/cli/preflight.ts` so P0 is an explicit step the
  workflow runs (and reports) rather than a side-effect of `loadConfig`.
- Add the missing report charts marked "(new)" above.
- Add the `--regression` top-level command shortcut.
- Cross-role report aggregation (one run summary per project).
- Sprint 7 retro: distil what this verification phase taught us.
