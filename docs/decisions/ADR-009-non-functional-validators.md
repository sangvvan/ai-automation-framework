---
id: ADR-009
title: Non-functional validators — axe, Web Vitals, security headers
status: accepted
date: 2026-05-17
deciders: planning agent
---

# ADR-009 — Non-functional validators

## Context
REQ-013 mandates accessibility, performance, security-header, and
compatibility checks alongside functional assertions. We need a uniform
integration point so the runner can dispatch all of them without
ad-hoc plumbing.

## Decision

### Interface

```ts
interface PostScenarioCheck {
  name: string;                  // 'a11y' | 'vitals' | 'security-headers'
  run(ctx: {
    page: Page;
    response?: Response;
    scenario: ExecutableScenario;
  }): Promise<ValidationCheck[]>;
}
```

### Registration
- Built-in checks live under `app/lib/validator/checks/non-functional/`.
- Enabled by `framework.config.yaml > validator.nonFunctional: ['a11y','vitals','security-headers']`.
- Order is fixed: a11y → vitals → security-headers (cheapest first).

### Axe-core
- Import `@axe-core/playwright` (already in deps).
- After the last step of each scenario, call
  `injectAxe(page)` then `getViolations(page)`.
- Map axe `impact` → WCAG level: `critical|serious → AA`, `moderate → A`,
  `minor → AAA`. Document the mapping in `docs/testing-standard.md`.
- Configurable failure gate per impact level.

### Web Vitals
- On `open_page`, inject the bundled `web-vitals` UMD via
  `page.addInitScript`.
- Hook `onLCP/onCLS/onINP/onTTFB` and stash values on `window.__aiTestVitals`.
- After the scenario, read the object via `page.evaluate`.

### Security headers
- After every navigation, capture `response.headers()`.
- Validate presence + sane values for: CSP, HSTS,
  X-Frame-Options/frame-ancestors, X-Content-Type-Options, Referrer-Policy.
- For each Set-Cookie: parse flags, require `Secure` in production,
  `HttpOnly` for session cookies, `SameSite` set.

### Reporting
- All non-functional check outputs flow into the same `ValidationCheck[]`
  collection on `ValidationResult` with `category: 'functional'|'a11y'
  |'performance'|'security'`.
- The HTML report groups checks by category in the scenario expand panel.

## Consequences
- One mechanism for adding future checks (e.g. SEO meta, broken-link).
- Categories make it easy to filter or gate by quality dimension.
- Default config keeps PS-001 behaviour (functional only) unchanged
  until operators opt in.

## Alternatives considered
- Run axe / vitals as separate post-run pass — rejected: lose per-step
  context, double-load pages.
- Use Lighthouse for everything — rejected: heavy, brittle in CI, no
  scenario context.
