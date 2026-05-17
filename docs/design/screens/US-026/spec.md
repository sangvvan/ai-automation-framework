# Design spec — US-026 Accessibility violations card

> Lives inside the scenario expand panel on `/runs/:runId` and inside
> the per-scenario block in the HTML report.

## Card
- Title: "Accessibility — N violations (M serious / K critical)"
- Sub-title: `WCAG 2.1 AA` (configurable).
- List rows, max 10 visible, "show all" toggles the rest:
  - Violation id (axe) + impact pill (`critical` rose / `serious`
    amber / `moderate` yellow / `minor` slate).
  - Description (one line, truncate).
  - Affected element: accessibleName + locator (semantic).
  - "Why this matters" link → `helpUrl` from axe.

## Empty state
- "No accessibility violations detected" (emerald check icon).

## Tokens
- Card padding: `p-4`; border-left coloured by worst impact.
- Impact pill same colour family as the existing status pills.

## A11y
- Card itself uses `role="region"` with `aria-label="Accessibility
  violations"`.
- Each row's "Why this matters" link is a real `<a target="_blank"
  rel="noopener noreferrer">`.

## Out of scope
- Suppressing specific rules in the UI (config-only).
