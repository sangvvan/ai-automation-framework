# Design spec — US-011 Runs list & run detail

## Routes
- `/runs` (index)
- `/runs/:runId` (detail)

## /runs (index)
### Layout
- Header: page title "Runs" + count badge.
- Right side: link "How do I create a run?" → opens a modal with the
  exact CLI command (copy button).
- Table:
  - Columns: ID · App · Mode · Totals (P/F/S) · Status · Started
  - Rows clickable → `/runs/:id`.
  - Sortable by Started (default desc).
- Empty state: hero with "No runs yet" + CLI snippet to copy.
- Pagination (50 per page).

### Tokens / accessibility
- Status pills as US-008.
- Table is `<table>` with `<th scope="col">`. Rows have keyboard activation.

## /runs/:runId (detail)
### Layout
- Header: run id, app URL, mode badge, started/finished, totals KPIs.
- Tabs: `Scenarios` (default) · `Evidence` · `AI trace`.
- **Scenarios tab**:
  - Filter chips: All · Pending · Approved · Rejected · Passed · Failed.
  - Scenario card list (vertical):
    - Title, type, priority, result status, review status.
    - Right-aligned actions:
      - `tester`: Approve · Reject (opens dialog) · Edit
      - `test-lead`: Approve · Reject · Edit · Promote to regression
      - `viewer`: no actions (read-only)
    - Expand: shows steps, expected result, AI rationale, evidence links.

### Bulk actions
- Sticky bar at the bottom of the scenarios tab when ≥1 selected:
  "Approve N selected" · "Reject N selected" — max 50.

### Reject dialog (US-013)
- Textarea (min 10 chars, max 500), counter, Cancel · Reject buttons.
- Submitting with <10 chars highlights field with error message.

### Empty / role gates
- `viewer` sees disabled action buttons with tooltip "Sign in as a tester
  to review scenarios."
- Promote button shows lock icon for `tester` with tooltip.
