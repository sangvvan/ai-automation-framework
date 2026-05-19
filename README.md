# AI Automation Framework

AI Automation Framework is an AI-assisted system testing tool for web
applications. It can analyze pages, execute YAML or Markdown test cases,
generate exploratory scenarios, capture Playwright evidence, and publish
structured JSON and HTML reports.

## Stack

- Remix, React, TypeScript, and Tailwind CSS for the review web UI.
- PostgreSQL 15 with raw SQL helpers under `app/lib/db/`.
- Playwright for browser execution and Vitest for unit/integration tests.
- Docker and GitHub Actions for local services and CI.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
docker compose up -d postgres
npm run db:migrate
```

Set at minimum `DATABASE_URL` and a 32+ character `SESSION_SECRET` in `.env`.

## Run A Test

Execute tester-provided cases:

```bash
npm run ai-test -- run \
  --url https://example.com/login \
  --test-case tests/fixtures/test-cases/login.yaml \
  --mode testcase
```

Generate exploratory scenarios from a URL:

```bash
npm run ai-test -- run --url https://example.com/login --mode explore
```

Reports are written under `reports/` at runtime and are ignored by git.

## Full Workflow

Create an input file for a target web app and its roles:

```yaml
# inputs/projects/my-app.yaml
project: my-app
baseUrl: https://app.example.com
roles:
  - name: admin
    authRecipe: inputs/auth/admin.yaml
  - name: viewer
    authRecipe: inputs/auth/viewer.yaml
crawl:
  maxPages: 50
  maxDepth: 3
generation:
  maxScenariosPerPage: 5
  categories: [positive, negative, validation, navigation]
```

Run the complete pipeline:

```bash
npm run ai-test -- workflow --input inputs/projects/my-app.yaml
```

The workflow authenticates each role, crawls a role-specific sitemap,
generates YAML test cases under `tests/generated/{project}/{role}/`, runs the
generated suite, and writes JSON/HTML reports under `reports/`.

You can also run each stage manually:

```bash
npm run ai-test -- crawl --url https://app.example.com --storage-state reports/auth/admin.json
npm run ai-test -- generate --site-map reports/sitemaps/C-...json --project my-app --role admin
npm run ai-test -- run-suite --cases-dir tests/generated/my-app/admin --site-map reports/sitemaps/C-...json
```

## Review UI

```bash
npm run dev
```

Open `http://localhost:3000/auth/register`, create a user, then review runs at
`/runs`. Test leads can approve, reject, and promote scenarios into regression
coverage.

## Project Layout

```text
app/
  routes/          Remix routes for auth, runs, review actions, and admin
  components/      Feature UI components
  lib/             AI providers, CLI, crawler, runner, reporter, auth, DB, Zod
db/
  migrations/      PostgreSQL schema migrations
  seeds/           Development seed data
docs/
  requirements/    Problem statements and REQ files
  user-stories/    US files with acceptance criteria
  tasks/           TASK files linked to implementation work
  decisions/       Architecture decision records
  design/          Screen and design-system specs
tests/
  fixtures/        Fixture app and sample test cases
```

## Quality Gates

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
```

Development conventions are captured in `AGENTS.md`, `CLAUDE.md`, and
`docs/testing-standard.md`.
