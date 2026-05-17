# Design spec — US-035 Defects view

## Route
`/runs/:runId/defects`

## Header
- Crumb + title `Defects — {N} open`.
- KPI row: open / triaged / fixed / won't-fix counts.
- Filters: status, severity, has-external-ref.

## Table columns
- Severity pill (high / med / low)
- Status pill (open / triaged / fixed / won't-fix)
- Summary (truncate, click → scenario detail with this defect anchored)
- Scenario id (mono, link)
- Created at (relative time)
- External ref (clickable URL or "Add" link if empty)
- Actions: Status menu (role-gated to tester+)

## Inline edit
- Status: `<select>` posts to
  `/runs/:runId/defects/:defectId/update`.
- External ref: small inline form with paste-and-save; URL validated.

## Defect drawer
- Click on a row opens a right-side drawer with:
  - Steps to reproduce (rendered as `<ol>`)
  - Evidence links (screenshot, trace, video)
  - Suggested defect summary (the original AI-generated one,
    immutable)
  - "Copy issue body" — Markdown bundling all of the above; clipboard
    icon and confirmation toast.

## Audit
- Status changes show "Status: open → triaged by Sang (12 min ago)" in
  the drawer history list, fed by `audit_log`.

## Empty state
- "No suggested defects from this run — nice." (emerald checkmark)

## A11y
- Drawer uses `role="dialog"` with focus trap.
- Status `<select>` has visible label "Defect status for
  {defect.summary}".

## Out of scope
- Auto-create Jira / GitHub issues. Manual paste only.
