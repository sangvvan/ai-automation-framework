# Design spec — US-012 Approve scenario

> Lives inside the run detail screen (see US-011).

## Interaction
- Approve button on each pending scenario card.
- Click → POST action → optimistic UI update:
  - Status pill flips to `approved` (emerald).
  - Toast: "Scenario approved · written to tests/approved/{slug}.yaml".
  - Reviewed-by chip appears with name + relative time.
- On server error → revert + red toast with the server message.

## Bulk approve
- Select multiple rows → "Approve N selected" button → confirm dialog
  showing the list of scenarios → POST.

## States
- Already approved: button hidden; chip "Approved by {name}, {relative}".
- Rejected: Approve hidden; "Re-open" link returns to `pending_review`
  (test-lead only).

## A11y
- Toast is `role="status"` with auto-dismiss 5s but pinned by hover.
- Approve button uses `aria-label="Approve scenario: {title}"`.

## Audit
- Every approve writes `audit_log` row before responding (transaction).
