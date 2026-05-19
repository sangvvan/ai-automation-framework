---
id: ADR-012
title: Workflow pipeline architecture — env → input → auth → sitemap → testcases → run → report
status: accepted
date: 2026-05-19
deciders: architect
supersedes: none
---

# ADR-012 — Workflow Pipeline Architecture

## Context

The framework now supports two execution surfaces:

- **`ai-test run`** — a one-off command for a single URL or a single
  SiteMap (existing PS-001 surface, kept stable).
- **`ai-test workflow`** — a YAML-driven orchestrator that runs the
  full life-cycle (auth → crawl → generate → run → report) per role
  per project. Introduced by Codex (TASK-035) and extended in
  Sprint 5/6 to cover the ISTQB-aligned reporting layer.

Until this ADR, the workflow's phase boundaries lived implicitly in
`app/lib/cli/commands/workflow.ts`. As we grow new phases (regression
gating, defect triage feedback, rerun-from-baseline), the implicit shape
becomes hard to reason about. This ADR makes the pipeline explicit:
each phase's inputs, outputs, failure modes, ISTQB anchors, and the
charts the final report renders.

## Decision

### 1. Phase topology

```text
              ┌─────────────────────────────────────────────────────────┐
              │                  ai-test workflow                       │
              │            (per project · per role · matrix)            │
              └─────────────────────────────────────────────────────────┘
                                       │
   ┌───────────────────────────────────┼──────────────────────────────────┐
   ▼               ▼                   ▼                ▼                ▼
 P0 Env-test    P1 Data input     P2 Auth login   P3 Discover       P4 Generate
 (preflight)   (workflow YAML)    (optional, per   (sitemap per     (per page,
                                   role recipe)    role)            ISTQB)
                                                       │                │
                                                       │                ▼
                                                       │           tests/generated/
                                                       │           <project>/<role>/
                                                       │             *.yaml
                                                       ▼                │
                                                  reports/sitemaps/    │
                                                  C-...json             │
                                                                        ▼
                                                                 P5 Run + validate
                                                                 (matrix browsers
                                                                  × locales)
                                                                        │
                                                                        ▼
                                                                 P6 Report
                                                                 (HTML+JSON+JUnit
                                                                  +TestPlan + PR
                                                                  comment +
                                                                  defects)
```

Each phase is **idempotent** given the same inputs. Phases write their
outputs to deterministic, content-addressed paths so a re-run with the
same `runId` would clobber but not corrupt anything. Promoted tests
(`tests/approved/`, `tests/regression/`) are append-only.

### 2. Phase contracts

#### P0 — Environment Testing (preflight)

Validates the runtime is sane before any browser launches or AI calls.

- **Inputs**: environment variables, configs/*.yaml, node version,
  Playwright browser presence, optional DB connectivity.
- **Outputs**: a `preflight` report (stdout + optional JSON). On any
  P0 failure, the workflow exits **before** touching the target app.
- **Checks**:
  - `Node >= 20` (or whatever `package.json#engines` declares).
  - At least one of: `PLAYWRIGHT_BROWSERS_PATH` set + browser present,
    or `~/.cache/ms-playwright/chromium-*` present.
  - `configs/framework.config.yaml` parses against `FrameworkConfig`.
  - `ai-provider.yaml` lists at least one provider; for each provider
    declared `enabled: true`, the required env var (`CLAUDE_API_KEY`,
    `CODEX_API_KEY`, …) is present.
  - DB optional: `DATABASE_URL` reachable when set (5s timeout); when
    unreachable, downstream DB writes (runs, scenarios, defects, audit)
    become no-ops with a single warning, not a failure.
  - For workflow runs with `prComment: true`: `GITHUB_TOKEN`,
    `GITHUB_REPOSITORY`, and PR number are present (warn-only).
- **Exit codes**: 0 OK, 2 misconfiguration, 3 missing browser.

> Module location: `app/lib/cli/preflight.ts` (new in Sprint 7 follow-up;
> until then the existing `loadConfig()` exception is the de-facto P0).

#### P1 — Data Input

Loads + validates the project's workflow YAML.

- **Inputs**:
  - `--input inputs/projects/<project>.yaml` — `WorkflowInput` schema.
  - Environment variables referenced as `${VAR}` substitutions inside
    auth recipes (resolved at recipe load time, not at YAML load).
- **Outputs**: parsed `WorkflowInput` in memory (Zod-validated).
- **Constraints**:
  - Workflow YAML never contains plaintext secrets — only
    `${ENV_VAR}` placeholders.
  - Schema is the only contract between phases. Adding a knob means
    extending `WorkflowInput` first.
- **Failure**: throws `WorkflowConfigError` with the offending field
  path. Exit code 2.

#### P2 — Auth Login (optional, per role)

If a role has `authRecipe` set, runs it once and captures the
`storageState` for all downstream phases on that role.

- **Inputs**:
  - `role.authRecipe` (path to `AuthRecipe` YAML).
  - `role.storageState` (optional pre-existing state to skip login).
  - Env vars substituted into recipe fields.
- **Outputs**:
  - `reports/auth/<project>/<role>.storage-state.json` (mode `0600`).
  - Audit log entry: `{ method, recipe_id, success, durationMs }`.
- **Failure modes**:
  - `AuthConfigError` — missing env var → exit 3.
  - `AuthError` — wrong credentials / form mismatch → exit 3.
  - `AuthExpiredError` — mid-run; one re-login attempt allowed.
- **Anti-leak**: secrets never logged; `storage-state.json` is
  gitignored by default.

#### P3 — Discover SiteMap (per role)

Polite BFS crawl from the role's effective entry URL.

- **Inputs**:
  - `baseUrl` (workflow root).
  - `crawl` config (maxPages, maxDepth, maxConcurrency, perHostQps,
    includeSubdomains, ignoreRobots, ignoreParams, routePatterns).
  - `storageStatePath` from P2.
- **Outputs**:
  - `reports/sitemaps/C-<runId>.json` (`SiteMap` Zod schema).
  - DB row in `crawls` when reachable.
  - Per-page evidence under `reports/evidence/<crawlId>/`.
- **Politeness invariants**:
  - `User-Agent: ai-test/<version>`.
  - Per-host token bucket throttles to `perHostQps`.
  - `robots.txt` honoured unless `ignoreRobots: true` (audited).
  - Same-origin only unless `includeSubdomains: true`.
  - Route-pattern collapsing (`/posts/1`, `/posts/2` → `/posts/:id`).
- **Failure**: per-page fetch errors do not abort the crawl; collected
  in `skipped[]` with a reason.

#### P4 — Generate Test Cases per Page (ISTQB)

For each SiteMap page, run the analyser + AI design agent to emit a
YAML test-case file. The bundle is reusable: subsequent regression runs
read these YAMLs directly via `ai-test run-suite` without re-generating.

- **Inputs**:
  - `SiteMap` from P3.
  - `generation.maxScenariosPerPage`, `generation.categories`,
    `generation.fallbackSmoke`.
  - `requestedTechniques` (CLI/workflow override; default = 7 ISTQB
    techniques).
  - AI provider chain (Claude → Codex → Opencode → Mock).
- **Outputs**:
  - `tests/generated/<project>/<role>/<page-slug>-<hash>.yaml` per page.
  - `manifest.json` summarising files, errors, source SiteMap.
  - `reports/evidence/generation/<project>/<role>/<page>/ai-trace.jsonl`
    for audit.
- **ISTQB coverage rules**:
  - **Technique coverage**: for every page with ≥1 input the agent
    emits at least one scenario per requested technique (the
    per-technique prompt addendum enforces tagging).
  - **Type coverage**: types map to ISO/IEC 25010:
    `functional` (default), `accessibility`, `performance`,
    `security`, `compatibility`, `usability`, `i18n` (added by the
    runner per-scenario when non-functional checks are enabled).
  - **Cap discipline**: `maxScenarios` divided across techniques; each
    technique gets at least 1 slot.
  - **Anti-harvest**: synthetic data only; never copy observed page
    values into fill values.
  - **Schema grounding**: every step references a locator present in
    the PageAnalysis (or marked `resolved: false` with a warning).
- **Fallback**: when generation returns 0 scenarios (e.g. Mock with no
  fixtures, all techniques skipped), emit a smoke scenario:
  `open_page(url)` + `verify_url(url)` so the file is still runnable.
- **Re-use**: the YAML output is canonical. Manual edits → diff with
  `manifest.json` source-of-truth; promoted to `tests/approved/` via
  the Review UI; promoted to `tests/regression/` by `test-lead`.

#### P5 — Run + Validate (matrix)

Executes the generated (or approved) test-case bundle against the
target app, applying the browser × locale matrix and non-functional
checks.

- **Inputs**:
  - `casesDir` (default `tests/generated/<project>/<role>/`, or
    `tests/approved/`, or `tests/regression/`).
  - `siteMapPath` (optional; used to restrict to in-scope pages).
  - `storageStatePath` from P2.
  - `run.browsers`, `run.locales`, `run.nonFunctional`.
- **Outputs**:
  - `ScenarioResult` per scenario × browser × locale.
  - `ValidationResult` per scenario (functional + a11y + perf +
    security checks merged into one `checks[]`).
  - `RunSummary` in memory (passed to P6).
  - Per-scenario evidence under `reports/evidence/<runId>/<scenarioId>/`:
    trace.zip, screenshots, ai-trace.jsonl, optional baseline diffs.
- **Stability invariants** (REQ-014):
  - Semantic locators only (role > label > text > testId).
  - `wait_for` with strategies: `visible | network-idle |
    mutation-stable | route-change`.
  - Self-healing (opt-in, same-kind, fuzzy Jaccard) with audit trail.
- **Budget enforcement** (REQ-017): per-run token budget; on breach,
  partial `RunSummary` is written with `interrupted: true`.

#### P6 — Report (professional HTML + JUnit + TestPlan)

Assembles every artefact and notifies subscribers.

- **Inputs**: `RunSummary`, optional previous `RunSummary` for the
  same `suiteTag` (regression diff).
- **Outputs**:
  - `reports/test-plans/<runId>.json` — ISTQB Test Plan (deterministic).
  - `reports/json/<runId>.json` — machine-readable RunSummary.
  - `reports/junit/<runId>.xml` — Jenkins-compatible per-suite report.
  - `reports/html/<runId>/index.html` — interactive report (see §3).
  - `reports/coverage/<runId>.json` — element + technique + AC coverage.
  - DB rows: `runs`, `scenarios`, `defects` (when DB reachable).
  - GitHub PR comment (when env present, idempotent via marker).

### 3. Professional HTML report — chart catalogue

The HTML report is **self-contained** (inlined CSS + SVG charts; no
CDN). Charts are static SVG so the report works offline, in CI
artefact viewers, and in PDF export.

| Chart | Position | Source data | Purpose |
|---|---|---|---|
| **Overview donut** | Header KPI | `summary.totals` | Pass / Fail / Skip ratio at a glance. |
| **Timeline ribbon** | Below KPI | `result.startedAt..finishedAt` per scenario | Identify long-running scenarios. |
| **Technique-coverage bar** | "ISTQB Technique coverage" panel | `summary.techniqueCoverage[]` | Pass rate per technique (EP/BVA/DT/ST/UC/PW/EG/EC). |
| **Type-coverage chips** | Test types row | derived from validators | functional/a11y/perf/security/compat/i18n chip strip. |
| **Browser × locale matrix** | Compatibility panel | tagged scenario id | Pass/fail tick per (browser, locale, scenario). |
| **Web Vitals dials** | Performance panel | `result.webVitals` per page | LCP / CLS / INP / TTFB with threshold colour. |
| **A11y violations heatmap** | Accessibility panel | `result.accessibilityViolations[]` | Counts per WCAG level (A / AA / AAA) × impact. |
| **Security headers table** | Security panel | `result.securityChecks[]` | Per-header pass/warn with severity. |
| **Element coverage heatmap** | Coverage panel | `RunCoverage` per page | Touched vs untouched interactive elements per page. |
| **Regression diff banner** | Top of report | `previousSummary` vs current | New failures / newly passing / carried failures. |
| **Defects table** | Defects panel | `validation.suggestedDefect[]` | Severity, status, evidence links, copy-as-issue button. |
| **Traceability matrix** | Test Plan tab | REQ → US → TC → Run → Defect | ISTQB-required deliverable. |
| **AI usage trace** | Footer | `ai-trace.jsonl` | Provider, role, attempt, tokens, cumulative budget. |

Rendering: pure server-side string templates (`app/lib/reporter/html.ts`)
with helper functions per chart. Charts are SVG strings built from
arrays (no client-side JS framework). Print stylesheet collapses tabs
into stacked sections so the full report PDF-prints cleanly.

### 4. Re-run / regression semantics

The generated YAMLs are the **canonical artefact** for re-execution:

```text
tests/generated/<project>/<role>/*.yaml      ← drafts (each workflow run)
tests/approved/<feature>/<id>.yaml           ← reviewer-approved (REQ-007)
tests/regression/<feature>/<id>.yaml         ← test-lead promoted
```

Re-run paths:

```bash
# Run the drafts as-is (after a fresh workflow)
ai-test run-suite --cases-dir tests/generated/<project>/<role>/

# Run only the regression-tagged suites
ai-test run --regression

# Run the same suite under a new browser matrix
ai-test run-suite --cases-dir tests/regression/auth/ \
  --browsers chromium,firefox,webkit --locales en,vi
```

`suiteTag` (e.g. `fixture-app-anonymous`) groups runs across time;
the HTML report's "Regression diff" panel finds the latest prior run
with the same tag and contrasts pass/fail per scenario.

### 5. Failure-mode → CLI exit-code matrix

| Failure | Exit | Phase |
|---|---|---|
| All scenarios passed | 0 | — |
| ≥1 scenario failed | 1 | P5 |
| Misconfig (workflow YAML, env, ai-provider) | 2 | P0 / P1 |
| Auth flow failed | 3 | P2 |
| Browser unreachable / target unreachable | 3 | P3 / P5 |
| Token budget exhausted mid-run | 4 | P4 / P5 |
| Internal orchestration error | 5 | any |

The Stop hook + CI gate read these to drive `git status` checks, PR
status updates, and per-job badges.

## Consequences

- Workflow phases are now first-class architectural units; adding a
  new phase (e.g. P6.5 "DefectTriage") only requires extending
  `WorkflowInput` + a new module under `app/lib/workflow/`.
- The ISTQB story is end-to-end: techniques are tagged at P4,
  measured at P5 (technique coverage), and surfaced at P6 (chart +
  Test Plan section). The "fully coverage" guarantee is enforced by
  the per-technique prompt addendum + the schema-validated
  `designTechnique` field on every scenario.
- The HTML report's chart catalogue is finite and documented; new
  panels are reviewable changes rather than ad-hoc additions.
- Re-run is just `ai-test run-suite --cases-dir …` against any
  YAML bundle — no AI cost, no crawl cost, deterministic.

## Alternatives considered

1. **One monolithic phase**: keep the workflow's `for role of roles`
   loop as the only structure. Rejected — phase boundaries become
   implicit, regression-test paths impossible to reason about, and
   non-functional / browser-matrix knobs accrete into the loop body.

2. **Phase per-CLI-command (no workflow)**: drop the `workflow`
   subcommand and expose 6 separate commands (`preflight`, `auth`,
   `crawl`, `generate`, `run-suite`, `report`). Rejected — too much
   boilerplate for users; the workflow YAML is a better operator
   interface and still composes cleanly with the lower-level commands
   for ad-hoc work.

3. **Client-side charts (Chart.js / D3 from CDN)**: would give
   interactive tooltips. Rejected — violates the "self-contained HTML
   report" principle (CSP-restricted CI viewers can't fetch CDNs;
   offline archival breaks). The static SVG approach is good enough
   for the catalogue above; interactivity can come later via a Remix
   `/runs/:id` route that already exists.

4. **Mermaid diagrams in HTML report**: rejected for the same offline
   reasons; ASCII / SVG only.

## Open questions

- Should `--regression` be a top-level `ai-test` command rather than a
  flag on `run`? (probably yes; tracked as a Sprint 7 follow-up).
- For multi-role workflows, do we want a top-level cross-role report
  in addition to per-role ones? (probably yes; the existing per-role
  `runId` makes aggregation cheap).
- AI cost dashboard (per project / per month): defer until billing
  surface is wired; the per-run trace already has the raw data.

## Links

- Companion architecture doc: `docs/architecture/workflow.md`
- ADR-006 — Crawler topology
- ADR-007 — Auth recipe DSL
- ADR-008 — TestPlan + TestSuite schemas
- ADR-009 — Non-functional validators
- ADR-010 — Self-healing locators
- ADR-011 — Screenshot baselining
- REQ-009..REQ-017 — universal-web + ISTQB requirements
