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

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Unreachable URL` | Target not resolvable from runner host | Check DNS / VPN / `--url` value |
| `MockProvider has no more fixtures` | explore mode but no API key | Configure a real provider, or accept the smoke-only fallback |
| `SESSION_SECRET not configured` | Web UI start without `.env` | `cp .env.example .env` then set `SESSION_SECRET` |
| Auth always 302 | Cookie blocked by host policy | Set `BASE_URL` and run over HTTPS in prod |
| Reports look stale | Old cached run id | Each run has a fresh id under `reports/` — list and re-open |
