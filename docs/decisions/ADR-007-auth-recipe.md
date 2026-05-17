---
id: ADR-007
title: Auth recipe DSL, secret handling, and storageState lifecycle
status: accepted
date: 2026-05-17
deciders: planning agent
---

# ADR-007 — Auth recipe DSL

## Context
REQ-010 needs a portable, safe way to describe a login flow. Recipes
must reference secrets without embedding them and must produce a
reusable storage state that survives across crawl + run.

## Decision

### Recipe shape (YAML, validated by Zod `AuthRecipe`)

```yaml
id: example-com
loginUrl: "https://example.com/login"
fields:
  username:
    locator: { kind: role, role: textbox, name: "Email" }
    value: "${SITE_USERNAME}"
  password:
    locator: { kind: role, role: textbox, name: "Password" }
    value: "${SITE_PASSWORD}"
submit:
  locator: { kind: role, role: button, name: "Sign in" }
postLogin:
  waitFor:
    - { kind: text, text: "Dashboard" }
  urlContains: "/app"
expectsCaptcha: false  # if true, run aborts with a clear message
sessionLifetimeMinutes: 30  # hint for re-login policy
```

### Secret substitution
- `${ENV_VAR}` placeholders resolved at load time from `process.env`.
- Resolved values held only in memory; never written to disk.
- Missing env var → `AuthConfigError` with the variable name.

### Storage state
- After successful login, capture `context.storageState()` and write
  to `reports/evidence/{run-id}/storage-state.json` with `chmod 0600`.
- Path is added to `.gitignore` (already covered by `reports/`).
- Subsequent browser contexts in the same run instantiate with this
  state. The crawler (REQ-009) and runner (REQ-004) both consume it.

### Session expiry
- Mid-run detection: any navigation that lands on the recipe's
  `loginUrl` (or matches `redirectedToLogin` selector) triggers a single
  re-login attempt; second expiry raises `AuthExpiredError` and halts.

### Audit
- A non-secret entry is appended to `audit_log` per login attempt:
  `{ recipe_id, success, durationMs, method: 'auto-detect'|'recipe' }`.

## Consequences
- Recipes are tiny, declarative, and reviewable in PRs.
- Secrets live in env (or CI secret store), never in repo.
- The recipe → storageState pattern keeps Playwright machinery local
  to one helper.

## Alternatives considered
- Imperative JS login hook — rejected: harder to review, opens path to
  arbitrary code execution.
- Cookie injection — rejected: brittle, server-side rotation breaks it.
- Browser session-record/replay — interesting future; recipes are
  enough for MVP.
