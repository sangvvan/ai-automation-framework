# Design spec — US-023 Suite view in Review UI

## Route
`/runs/:runId/suites/:suiteId`

## Layout
- **Header**:
  - Crumb: `Runs › {runId} › Suites › {suite.name}`.
  - Suite name + feature slug, regression badge if set.
  - Inline timings: setup-hook duration, teardown-hook duration.
- **Counts row**: passed / failed / skipped · total — KPI cards.
- **Scenarios list**: re-use the scenario card component from
  `/runs/:runId`. Filter chips identical to that page.
- **Suite actions** (right side, role-gated):
  - `Re-run suite` (tester+) → POST `/runs/:runId/suites/:suiteId/rerun`
    (launches CLI under the hood — phase 2 follow-up; phase 1 just
    shows the copy-paste CLI command).
  - `Mark regression` / `Unmark` (test-lead) — toggles
    `regression_tag`.

## States
- Setup hook failed → red banner with stderr collapsed-by-default;
  scenarios still listed but show "blocked by setup" pill.
- Empty suite → "No scenarios in this suite" + CLI snippet to add one.

## Filter chip
- `/runs/:runId` page gets a new "Suite" filter chip-row; selecting a
  suite restricts the scenario list to that suite.
