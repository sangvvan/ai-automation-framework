---
id: ADR-005
title: Semantic-first locator strategy and keyword action library
status: accepted
date: 2026-05-17
deciders: planning agent
---

# ADR-005 — Locators and keyword actions

## Context
Flaky tests are the #1 risk (PS §15.2). Locator strategy must be semantic
and resilient to UI churn.

## Decision

### Locator priority (resolved by `Resolver.resolve(locator, page)`):
1. `byRole(role, { name })`
2. `byLabel(text)`
3. `byText(text)` (exact > regex)
4. `byTestId(value)`

### Banned
- CSS class selectors, `nth-child`, XPath.
- `page.waitForTimeout`.
- Raw `page.locator` / `page.$` outside `app/lib/runner/keywords/`.

### Keyword actions (initial library)
- `open_page(url)`
- `click(target)`
- `fill(target, value)`
- `select(target, value)`
- `verify_text({ target?, text })`
- `verify_url(pattern)`
- `wait_for(target)`

Each keyword is one file under `app/lib/runner/keywords/` exporting:
```ts
export async function click(ctx: RunnerContext, args: { target: Locator }): Promise<void>;
```

### Step timeouts and retries
- `stepTimeoutMs` default 10000, configurable per run.
- Locator resolution retries every 100ms until visible & enabled.
- No global "auto-retry on failure" — flakiness must be visible.

## Consequences
- Tests resilient to CSS refactors.
- Keyword library is the only API surface for scenario authors.
- Lint rule (custom): disallow `page.locator` / `page.$` outside the
  keywords folder.

## Alternatives considered
- WebDriver-style XPath selectors — rejected (brittle).
- Auto-healing locators — deferred (introduces nondeterminism).
