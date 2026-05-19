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

## CLI proposal

```bash
# Full run
npm run framework -- workflow \
  --url https://example.app \
  --account ./secrets/account.json \
  --specs ./specs

# Re-run failed cases from previous run
npm run framework -- rerun \
  --from output/runs/RUN-20260519-001 \
  --failed-only

# Re-run specific testcase IDs
npm run framework -- rerun \
  --testcases TC-LOGIN-003,TC-CHECKOUT-002
```
