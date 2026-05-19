# Full Workflow: Sitemap → Test Cases → Automation Run → Re-run

## Goal
Build a tester-first orchestration flow where users provide:
- Target web link
- Account context
- Optional specs folder

The framework then runs end-to-end automation by generating a sitemap, creating test cases per sitemap node, synthesizing executable tests, executing them, and exporting reusable artifacts for re-run.

## End-to-end flow

1. **Input intake**
   - Validate URL format.
   - Validate account object (at least one auth method).
   - Resolve optional specs folder.

2. **Sitemap discovery**
   - Crawl start URL (post-login when credentials provided).
   - Build `sitemap.json` with nodes, edges, and page classification.

3. **Spec resolution**
   - If specs folder exists: map external specs to sitemap nodes.
   - If no specs folder: generate `spec.generated.md` per node group.

4. **Test case generation**
   - Generate test case sets for each sitemap node and primary transitions.
   - Required categories per node:
     - happy path
     - validation failure
     - auth/permission
     - empty state
     - error state

5. **Automation synthesis**
   - Compile test cases into executable suites.
   - Persist generated tests under `output/tests/generated/`.

6. **Execution**
   - Run smoke suite first.
   - Run full suite second.
   - Capture evidence: screenshots, traces, logs, videos (if enabled).

7. **Reporting and re-run pack**
   - Produce a single run report with pass/fail, failures by node, flaky indicator.
   - Produce `rerun-manifest.json` keyed by testcase IDs and suite IDs.

## Output contract

```text
output/
  sitemap/
    sitemap.json
  specs/
    spec.generated.md                 # only when specs input is missing
  testcases/
    TC-<NODE>-001.json
  tests/
    generated/
      <node>.spec.ts
  runs/
    <run-id>/
      results.json
      report.md
      artifacts/
  rerun/
    rerun-manifest.json
```

> **Conformance note** — the design above is implemented today by the
> `ai-test` CLI but under the framework's existing directory conventions
> (no separate `output/` namespace; artefacts live where the rest of
> the framework can find them). Mapping:
>
> | Design contract | Actual location |
> |---|---|
> | `output/sitemap/sitemap.json` | `reports/sitemaps/C-<crawlId>.json` (+ `crawls` DB row) |
> | `output/specs/spec.generated.md` | `docs/requirements/PS-AUTO-<project>.md` (only when `--auto-specs` set and no `--specs` folder) |
> | `output/testcases/TC-*.json` | `tests/generated/<project>/<role>/*.yaml` (+ `manifest.json`) |
> | `output/tests/generated/<node>.spec.ts` | Not produced — keywords run from YAML at runtime via `runScenarios`, no `.spec.ts` codegen step. Re-run treats the YAML bundle as the executable artefact. |
> | `output/runs/<run-id>/results.json` | `reports/json/<runId>.json` |
> | `output/runs/<run-id>/report.md` | `reports/html/<runId>/index.html` (rich HTML) + `reports/junit/<runId>.xml` |
> | `output/runs/<run-id>/artifacts/` | `reports/evidence/<runId>/<scenarioId>/` (trace.zip + screenshots + ai-trace.jsonl) |
> | `output/rerun/rerun-manifest.json` | Not a separate file — `ai-test rerun --from <runId> --failed-only` reads the prior `reports/json/<runId>.json` directly; the JSON itself is the manifest. |


## Suggested JSON schemas

### `sitemap.json`

```json
{
  "runId": "RUN-20260519-001",
  "rootUrl": "https://example.app",
  "nodes": [
    {
      "nodeId": "NODE-LOGIN",
      "url": "https://example.app/login",
      "title": "Login",
      "type": "form",
      "requiresAuth": false
    }
  ],
  "edges": [
    {
      "from": "NODE-LOGIN",
      "to": "NODE-DASHBOARD",
      "action": "submit-login"
    }
  ]
}
```

### `testcase.json`

```json
{
  "testcaseId": "TC-LOGIN-001",
  "nodeId": "NODE-LOGIN",
  "type": "happy_path",
  "preconditions": ["user account exists"],
  "steps": ["Open login page", "Enter valid credentials", "Submit"],
  "expected": ["Dashboard is visible"],
  "automation": {
    "suiteId": "SUITE-AUTH",
    "testFile": "output/tests/generated/login.spec.ts",
    "testTitle": "TC-LOGIN-001 valid login"
  }
}
```

### `rerun-manifest.json`

```json
{
  "sourceRunId": "RUN-20260519-001",
  "generatedAt": "2026-05-19T00:00:00.000Z",
  "failedTestcaseIds": ["TC-LOGIN-003"],
  "mappings": [
    {
      "testcaseId": "TC-LOGIN-003",
      "suiteId": "SUITE-AUTH",
      "testFile": "output/tests/generated/login.spec.ts",
      "testTitle": "TC-LOGIN-003 invalid password"
    }
  ]
}
```

## MVP constraints

- Crawl depth default: 3.
- Supported roles: `user`, `admin`.
- Execution target: browser-based end-to-end only.
- Re-run modes:
  1. failed-only
  2. testcase-id list
  3. node-id filter

## CLI (implemented)

```bash
# Full run from a single URL — tool synthesises the workflow YAML +
# auth recipe + (optionally) a spec doc, then invokes the workflow.
npm run ai-test -- quick \
  --url https://example.app \
  --username "$SITE_USERNAME" --password "$SITE_PASSWORD" \
  --specs ./specs                  # or --auto-specs to draft via AI

# Equivalent low-level invocation once inputs/projects/<project>.yaml
# is written (manually or by quick):
npm run ai-test -- workflow --input inputs/projects/example.yaml

# Re-run only the scenarios that failed in a previous run.
npm run ai-test -- rerun \
  --from R-20260519-... \
  --failed-only

# Re-run specific test-case IDs.
npm run ai-test -- rerun \
  --testcases TC-LOGIN-003,TC-CHECKOUT-002

# Re-run the curated regression corpus (after Review-UI promotion).
npm run ai-test -- regression --feature checkout \
  --browsers chromium,firefox --vitals --a11y
```

The `quick` command is the highest-level entry point (URL → everything);
`workflow` is the low-level engine; `rerun` and `regression` are the
two re-execution paths.
