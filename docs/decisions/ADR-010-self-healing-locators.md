---
id: ADR-010
title: Self-healing locator strategy
status: accepted
date: 2026-05-17
deciders: planning agent
---

# ADR-010 — Self-healing locators

## Context
REQ-014 wants the runner to attempt one round of "healing" when a
locator fails to resolve, but without sacrificing determinism in the
default mode.

## Decision

### Trigger
- Healing is **opt-in** via `runner.selfHeal: true`.
- Triggered only when `resolveLocator` raises `LocatorNotFoundError`
  during a keyword call (not during page analysis).

### Candidate generation
- Capture the page's PageAnalysis (re-run analyzer in-place).
- Score each candidate `PageElement` against the failed locator using
  a weighted similarity:
  - Same `kind` is required (a `role` locator can only heal to another
    `role`; same for `label` / `text` / `testId`).
  - Token Jaccard over normalized accessibleName / locator text.
  - Tie-break: position in DOM order matching the failed locator's
    original ordinal.
- Keep candidates with score ≥ `0.6` (configurable).

### Trial
- Try candidates in score order, max 3, with the original keyword.
- First success wins; record `StepResult.healEvent = { from, to, score }`.
- All-fail → re-raise the original `LocatorNotFoundError`.

### Audit + reporting
- Every heal event is appended to the run audit log.
- `RunSummary.totals.healed` exposes the count.
- HTML report annotates healed scenarios with a "healed" badge and
  expands to show old vs new locator.

### Safety
- Healing **never** alters the scenario YAML — the original locator
  remains the canonical truth.
- Operators can promote a healed locator to the canonical one by
  approving a "locator suggestion" defect (REQ-017).

## Consequences
- Adds resilience to minor UI churn without hiding intentional
  changes from review.
- Determinism is preserved when `selfHeal` is off.

## Alternatives considered
- Auto-rewrite the scenario file on heal — rejected: violates
  human-in-the-loop principle (PS-001 §9.5).
- ML-based locator embeddings — over-engineered for MVP++; revisit
  when fuzzy similarity proves inadequate.
