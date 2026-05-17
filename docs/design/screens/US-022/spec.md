# Design spec — US-022 Test Plan HTML tab

## Where it lives
A new tab in the existing per-run HTML report
(`reports/html/{run-id}/index.html`), to the left of the existing
`Scenarios` tab.

## Sections (top to bottom)

1. **Header band** — `Test Plan: {run-id}` · `Test level: system` ·
   generated-at timestamp.
2. **Scope** — two columns: `In scope` (URLs/features) and `Out of
   scope`. Bulleted lists.
3. **Test items** — table: `Name` · `URL` · `Route pattern` (rows from
   SiteMap).
4. **Levels & types** — two pill rows: levels (system / acceptance /
   integration / component / unit) with the active ones highlighted;
   types (functional / a11y / performance / security / compatibility /
   usability / i18n) same treatment.
5. **Approach** — narrative paragraph (AI-written or template
   fallback). Italic dim "auto-generated" label when from template.
6. **Entry & exit criteria** — checklist items rendered as `<ul>`,
   each row with a status dot when the engine can evaluate it
   (e.g. "All P1 suites pass" → green when totals.failed for P1 = 0).
7. **Risks** — table: `Description` · `Likelihood` · `Impact` ·
   `Mitigation` · `Severity color` (likelihood×impact).
8. **Schedule** — small grid: planned / actual start + end.
9. **Resources** — automation tool + AI providers + browsers + locales.
10. **Deliverables** — bullet list with links (HTML report, JSON,
    JUnit, evidence dir, sitemaps).
11. **Traceability matrix** — table `REQ` · `Test Condition` ·
    `Test Cases` · `Run` · `Defects`. Each cell links where applicable.

## Tokens
- Pill: emerald for active, slate for inactive; dark variants apply.
- Risk severity colour (likelihood × impact):
  `low/low` = slate, `med/med` = amber, `high/high` = rose.

## Accessibility
- Tabs are `role="tablist"` / `role="tab"` / `role="tabpanel"` with
  ARIA-controls wiring; keyboard arrows switch tabs.
- Traceability table is `<table>` with `<th scope>` headers.

## Print
- `@media print` collapses tabs into stacked sections so the full Plan
  prints to PDF without interaction.

## Out of scope
- Editing the Plan in the UI. Plans are read-only post-generation.
