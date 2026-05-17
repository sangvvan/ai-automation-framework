# Testing standard

This document is the **contract** the framework's own tests follow,
and the standard it advocates for any web application it tests.

---

## 1. Layers

| Layer | Tool | Location | What it covers |
|---|---|---|---|
| Unit | Vitest | Co-located `*.test.ts` next to source | Pure functions, Zod schemas |
| Integration | Vitest + real Postgres | `app/lib/db/*.test.ts` | DB helpers (no mocks) |
| Component | Vitest + happy-dom + @testing-library/react | `app/components/**/*.test.tsx` | Render + keyboard interaction |
| E2E | Playwright + Page Objects | `tests/e2e/*.spec.ts` | Per-route happy + edge cases |
| Accessibility | @axe-core/playwright | colocated in e2e specs | WCAG 2.1 AA per route |

---

## 2. Page Object Model

- Every screen has one file under `tests/pom/{Feature}Page.ts`.
- POMs expose **semantic** locators only (`byRole`, `byLabel`, `byText`,
  `byTestId`) — no CSS classes, no `nth-child`, no XPath.
- POMs expose `assertLoaded()` that waits on a stable, user-visible
  signal — never `waitForTimeout`.
- Specs never call `page.*` directly; they call POM methods.

---

## 3. Coverage gates

- Lines ≥ 80%, Functions ≥ 80%, Branches ≥ 75%, Statements ≥ 80%.
- Every Zod schema: at least one accept + one reject test.
- Every DB helper: a round-trip integration test against the real test
  Postgres.
- Every public route: an axe-core a11y test.

---

## 4. Risk-based prioritisation

| Priority | Scope examples |
|---|---|
| **P1** | Auth, payment, data write, anything that breaks the user's session |
| **P2** | Validation, navigation, list pagination, role gating |
| **P3** | UI consistency, copy, low-traffic edge cases |

The AI generation agent emits a `priority` for each scenario it produces;
the reviewer is expected to verify or override it before approval.

---

## 5. Human-in-the-loop

AI-generated scenarios are **never** promoted to the regression suite
without human review (REQ-007). The framework enforces this via:

- New scenarios are inserted with `review_status = 'pending_review'`.
- Only approved scenarios can be promoted.
- Only `test-lead` users can promote.
- The `audit_log` records every action.

---

## 6. Bug reporting

When a scenario fails, the Validator emits a `suggestedDefect` with:

- Summary line.
- Steps to reproduce (rendered from `StepResult[]`).
- Evidence links (screenshot path + trace path).
- Severity hint (`high` for execution failure, `med` for assertion
  failure, `low` for warn-only).

This block is intended to be copy-pasted into a Jira / GitHub issue. The
framework itself does **not** file defects automatically (PS §14.2).
