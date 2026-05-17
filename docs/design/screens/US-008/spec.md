# Design spec — US-008 HTML report

## Purpose
Self-contained, offline-viewable HTML report for one run. Audience:
testers, devs, Test Leads.

## Layout
- **Header (sticky)**: app name, run id, mode badge, started/finished
  timestamps. On the right: `Open JSON` link, `Open evidence dir` link.
- **KPI strip**: 4 cards — Total · Passed (green) · Failed (red) ·
  Skipped (gray). Each card shows count + % of total.
- **Suite tag + regression-diff banner** (when prior run exists):
  yellow band with counts: "+3 new failures, +1 newly passing".
- **Filter bar**: status (passed/failed/skipped/all), type, priority,
  search.
- **Scenario table**: collapsible rows. Columns:
  Status · Title · Type · Priority · Duration · Origin.
- **Row expanded**: numbered steps with status pill, failure reason
  blockquote, evidence links (screenshot inline thumbnail, trace download,
  console log toggle).
- **Footer**: framework version, generated-at, tester signature (if any).

## Tokens
- Status pills: `bg-emerald-100 text-emerald-800` (pass),
  `bg-rose-100 text-rose-800` (fail), `bg-slate-100 text-slate-700` (skip).
- Dark variants: same hue, 800/300 inverse.
- Font: system-ui stack.

## Accessibility
- All status badges have aria-label including the textual status.
- Rows expandable via keyboard (Enter/Space on the chevron button).
- Screenshot thumbnails have alt text "Screenshot of {scenario title} at
  step {n}".
- Contrast ≥ 4.5:1.

## States
- Empty (no scenarios): "No scenarios in this run." with link to CLI docs.
- All passed: KPI Failed card hidden details; "All scenarios passed" hero.

## Out of scope
- Live updates, multi-run comparison view (post-MVP).
