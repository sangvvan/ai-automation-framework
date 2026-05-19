# User guide — ai-test framework

`ai-test` is an AI-powered system test automation framework for web
applications. You give it a URL (plus optionally a YAML/Markdown test
case) and it analyses the page, generates or executes scenarios, captures
evidence, and produces a structured report.

---

## 1. Install

```bash
git clone <repo>
cd ai-automation-framework
npm install
npx playwright install chromium    # downloads the browser binary
cp .env.example .env               # edit DATABASE_URL + SESSION_SECRET
docker compose up -d postgres      # or point DATABASE_URL elsewhere
npm run db:migrate                 # apply db/migrations/*.sql
```

`SESSION_SECRET` must be at least 32 chars. Generate one with
`openssl rand -hex 32`.

---

## 2. Two execution modes

### Mode A — `testcase` (you provide the steps)

Author a YAML test case:

```yaml
# inputs/test-cases/login.yaml
page_url: "https://example.com/login"
test_cases:
  - id: TC_LOGIN_001
    title: "Login with valid credentials"
    priority: P1
    steps:
      - Open login page
      - Enter sang in username
      - Enter password123 in password
      - Click Login
      - Verify Welcome back, Sang
    expected_result: "Welcome back, Sang"
```

Run it:

```bash
npm run ai-test -- run \
  --url https://example.com/login \
  --test-case inputs/test-cases/login.yaml \
  --mode testcase
```

Markdown is also accepted — see `docs/architecture.md`.

### Mode B — `explore` (AI generates the scenarios)

```bash
AI_TEST_DEFAULT_PROVIDER=claude CLAUDE_API_KEY=... \
  npm run ai-test -- run --url https://example.com/login --mode explore
```

Without an API key the framework falls back to `mock` and emits a single
smoke scenario so the skeleton still produces output. Configure the
provider chain in `configs/ai-provider.yaml`.

---

## 3. Reading the report

Every run writes three artefacts:

- `reports/json/{run-id}.json` — machine-readable `RunSummary`.
- `reports/html/{run-id}/index.html` — self-contained HTML report.
- `reports/evidence/{run-id}/...` — per-scenario screenshots, traces,
  console logs, and the AI trace (when explore mode is used).

Print the path to the HTML report:

```bash
npm run ai-test -- report --run-id R-20260517-100000-abcd
```

---

## 4. The Review web UI

```bash
npm run dev
```

Open <http://localhost:3000/auth/register>, create your account (defaults
to role `tester`), and you'll land on `/runs`. Each run page lists its
scenarios with their result + review status. Pending scenarios can be:

- **Approved** — writes `tests/approved/{feature}/{id}.yaml`.
- **Rejected** — requires a reason ≥10 chars; hidden from default
  regression by default.

To promote a scenario into the regression suite you need role
`test-lead` (assign manually in the DB for now). Promoted scenarios are
written to `tests/regression/{feature}/{id}.yaml`.

Every action is recorded in the `audit_log` table.

---

## 5. Configuration

Three YAML files, deep-merged, then overridden by `AI_TEST_*` env vars:

- `configs/framework.config.yaml` — runner, reporting, generation defaults.
- `configs/test-env.yaml` — environment-specific test settings.
- `configs/ai-provider.yaml` — provider routing + fallback chain.

`app/lib/config.ts` is the only file that reads `process.env`. See
`docs/architecture.md` §3 for the precedence rules.

---

## 6. CI

`.github/workflows/ci.yml` runs four jobs on every PR/push:

1. `quality` — typecheck + lint.
2. `unit` — Vitest with coverage against a real Postgres service.
3. `e2e` — installs Chromium, starts the fixture app, runs the smoke
   `ai-test run` against it, uploads the report directory as an artefact.
4. `secret-scan` — gitleaks against the full history.

All four must be green before merge.

---

## 7. Universal-web pipeline (SPRINT-004)

Test an entire app from one URL, including protected pages:

```bash
# 1. Discover pages (polite, robots-aware)
npm run ai-test -- crawl --url https://app.example.com \
  --max-pages 25 --max-depth 3 --per-host-qps 2

# 2. (Optional) protected app — capture a session
SITE_USERNAME=ada@example.com SITE_PASSWORD=Pa55! \
  npm run ai-test -- auth detect --url https://app.example.com/login
# review inputs/auth/app-example-com.draft.yaml, then:
npm run ai-test -- auth login --recipe inputs/auth/app-example-com.draft.yaml

# 3. Multi-page run from the SiteMap
npm run ai-test -- run --site-map reports/sitemaps/C-...json --mode explore
```

Outputs: `reports/sitemaps/{crawl-id}.json` + per-page evidence under
`reports/evidence/{run-id}/<page-hash>/`.

## 8. ISTQB-aligned reports (SPRINT-005)

Every run now emits, in addition to HTML + JSON:

| Artefact | Path |
|---|---|
| **Test Plan** (ISTQB-CTFL shape) | `reports/test-plans/{run-id}.json` |
| **JUnit XML** (Jenkins/GitLab/Azure) | `reports/junit/{run-id}.xml` |

New CLI flags:

```bash
# Tag the test level on the report
npm run ai-test -- run --url … --test-level acceptance --mode explore

# Drive AI generation by specific ISTQB design techniques
npm run ai-test -- run --url … --mode explore \
  --techniques boundary-value,decision-table,error-guessing
```

Each generated scenario carries a `designTechnique` field; HTML report
renders a "Technique coverage" panel.

YAML test cases can declare the technique:

```yaml
test_cases:
  - id: TC_LOGIN_001
    design_technique: use-case
    steps: …
```

### Non-functional checks

- **Accessibility**: `@axe-core/playwright` violations → result.accessibilityViolations, mapped to WCAG levels.
- **Performance**: inline `web-vitals` capture → LCP/CLS/INP/TTFB, configurable thresholds (warn vs fail).
- **Security**: response headers (CSP, HSTS, X-Frame-Options or frame-ancestors, nosniff, Referrer-Policy) + cookie Secure/HttpOnly/SameSite.
- **SPA waits**: `wait_for(strategy: visible | network-idle | mutation-stable | route-change)`.

## 9. Multi-browser, locale, defects, baselines, PR comment (SPRINT-006)

CLI flag matrix:

```bash
# Browser compatibility matrix
npm run ai-test -- run --url … --mode explore \
  --browsers chromium,firefox,webkit

# i18n: same suite per locale
npm run ai-test -- run --url … --mode explore --locales en,vi,ja

# Toggle non-functional checks
npm run ai-test -- run --url … --mode explore --a11y --vitals --security-headers

# Cap AI usage
npm run ai-test -- run --url … --mode explore --budget 50000
```

Additional artefacts:

| Artefact | Path |
|---|---|
| Defects (one per failed scenario) | DB `defects` rows + `/runs/:runId/defects` UI |
| Screenshot baselines | `reports/baselines/<suite>/<scenario>/<name>.png` |
| Element coverage | `reports/coverage/{run-id}.json` |
| PR comment | Posted to GitHub when `GITHUB_TOKEN`+`GITHUB_REPOSITORY`+PR context set |

Screenshot baseline workflow:

```bash
# Add verify_screenshot('home') step to a scenario; first run captures
# the baseline. Subsequent runs diff against it.

# Promote new screenshots after an intentional UI change
npm run ai-test -- baselines accept --run-id R-…
```

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Unreachable URL` | Target not resolvable from runner host | Check DNS / VPN / `--url` value |
| `MockProvider has no more fixtures` | explore mode but no API key | Configure a real provider, or accept the smoke-only fallback |
| `SESSION_SECRET not configured` | Web UI start without `.env` | `cp .env.example .env` then set `SESSION_SECRET` |
| Auth always 302 | Cookie blocked by host policy | Set `BASE_URL` and run over HTTPS in prod |
| Reports look stale | Old cached run id | Each run has a fresh id under `reports/` — list and re-open |

---


## 10. Full workflow run with sitemap-scoped testcase re-run

This mode is for testers who want one command to run the complete automation
pipeline:

1. Build sitemap
2. Generate or map specs
3. Generate test cases per sitemap node
4. Compile automation suites from generated test cases
5. Execute suites and publish re-run pack

```bash
# Full workflow
npm run ai-test -- workflow   --url https://app.example.com   --account inputs/auth/app-account.json   --specs ./specs

# Re-run only failed test cases from a previous run
npm run ai-test -- rerun   --from output/runs/RUN-20260519-001   --failed-only
```

Expected artifacts:
- `output/sitemap/sitemap.json`
- `output/specs/spec.generated.md` (only when `--specs` is omitted)
- `output/testcases/*.json`
- `output/tests/generated/*.spec.ts`
- `output/runs/<run-id>/report.md`
- `output/rerun/rerun-manifest.json`

See `docs/full-workflow-sitemap-rerun.md` for the detailed contract and
schemas.
