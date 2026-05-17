---
id: ADR-011
title: Screenshot baseline storage and diffing
status: accepted
date: 2026-05-17
deciders: planning agent
---

# ADR-011 — Screenshot baselining

## Context
REQ-014 introduces `verify_screenshot(name)` and a baseline workflow.
We need a storage layout, a deterministic diff algorithm, and an
acceptance pathway that doesn't push large binaries into git
unnecessarily.

## Decision

### Storage layout

```
reports/baselines/
  <suite-slug>/
    <scenario-id>/
      <shot-name>.png         # canonical baseline
      <shot-name>.metadata.json  # { capturedAt, viewport, browser, threshold }
```

- Stored on disk by default. CI may sync to S3 via a small adapter
  (out of scope for this enhancement; the path indirection in
  `framework.config.yaml > baselines.storage: 'fs' | 's3'` keeps the
  door open).
- Git-friendly: small PNGs (< 200 KB each) committed by intention. The
  CLI accepts a `--no-git` baseline mode for teams that prefer S3.

### Diff
- Use `pixelmatch` (small, no deps) over `pngjs`.
- Default threshold per pixel `0.1`; default failure delta
  `0.001` (0.1% of pixels). Both configurable per shot.
- Diff image saved to `reports/evidence/{run-id}/{scenario}/diff-{name}.png`
  when delta exceeds threshold.

### Sensitive-field masking
- Before capture: query the PageAnalysis for elements with
  `isSensitive: true`. For each such element, overlay a black rect
  using `page.evaluate` before `page.screenshot`.
- Mask is removed after capture so the page DOM is unaffected.

### Acceptance
- `ai-test baselines accept --run-id <id> [--shot <name>]` walks the
  evidence dir and replaces matching baselines. Every replacement is
  logged to `audit_log` with `action: 'baseline_accept'`.

## Consequences
- Visual regression becomes a first-class check without a service.
- Small bins live in git; teams uncomfortable with that can flip the
  storage flag without code changes.
- Acceptance is explicit, leaving an audit trail.

## Alternatives considered
- Percy / Chromatic — paid SaaS, out of scope.
- Storybook visual regression — only for component libs, not full pages.
- LFS for baselines — adds operational complexity; revisit if PNGs
  bloat beyond 200 KB per shot.
