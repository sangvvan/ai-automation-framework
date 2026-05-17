---
id: TASK-051
parent_us: [US-034]
parent_req: REQ-014
sprint: SPRINT-006
status: planned
estimate: 4h
---

# TASK-051 — Screenshot diff baselining + verify_screenshot keyword

## Goal
- New keyword `verify_screenshot(name, [threshold])` per ADR-011.
- Storage layout under `reports/baselines/{suite}/{scenario}/`.
- Mask sensitive fields before capture.
- `pixelmatch` + `pngjs` for diff; write diff PNG when over threshold.

## Files
- `app/lib/runner/keywords/verify-screenshot.ts`
- `app/lib/runner/baseline-store.ts`
- `app/lib/runner/mask-sensitive.ts`

## Acceptance
- US-034 AC-1..AC-5 (AC-4 wired in TASK-052).

## llm_execution
target      : cloud
reason      : image diff + masking
complexity  : medium
context_size: small
