---
id: ADR-008
title: TestPlan and TestSuite schemas — ISTQB-aligned shape
status: accepted
date: 2026-05-17
deciders: planning agent
---

# ADR-008 — TestPlan & TestSuite schemas

## Context
REQ-011 needs formal documents. We adopt a slimmed shape inspired by
ISTQB-CTFL and IEEE 829 — enough fields to satisfy auditors without
boilerplate.

## Decision

### TestPlan (Zod, persisted to `reports/test-plans/{run-id}.json`)

```ts
TestPlan = z.object({
  id: z.string(),                     // == runId
  generatedAt: z.string().datetime(),
  app: z.string(),
  scope: z.object({
    inScope: z.array(z.string()),     // URLs / features / flows
    outOfScope: z.array(z.string()),
  }),
  testItems: z.array(z.object({       // typically pages from SiteMap
    name: z.string(),
    url: z.string(),
    routePattern: z.string().optional(),
  })),
  levels: z.array(z.enum([
    "unit","component","integration","system","acceptance"
  ])),                                // default ['system']
  types: z.array(z.enum([
    "functional","accessibility","performance",
    "security","compatibility","usability","i18n"
  ])),
  approach: z.string(),               // 1-3 paragraph narrative
  entryCriteria: z.array(z.string()),
  exitCriteria: z.array(z.string()),
  risks: z.array(z.object({
    description: z.string(),
    likelihood: z.enum(["low","med","high"]),
    impact: z.enum(["low","med","high"]),
    mitigation: z.string().optional(),
  })),
  schedule: z.object({
    plannedStart: z.string().datetime().optional(),
    plannedEnd: z.string().datetime().optional(),
    actualStart: z.string().datetime(),
    actualEnd: z.string().datetime().optional(),
  }),
  resources: z.object({
    automation: z.string().default("ai-test framework"),
    aiProviders: z.array(z.string()),
    browsers: z.array(z.string()),
    locales: z.array(z.string()),
  }),
  deliverables: z.array(z.string()),
  traceabilityMatrix: z.array(z.object({
    reqId: z.string(),
    testCondition: z.string(),        // paragraph or AC sentence
    testCaseIds: z.array(z.string()), // scenario ids
    runId: z.string(),
    defectIds: z.array(z.string()),
  })),
});
```

### TestSuite (DB-backed)

```sql
test_suites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  name            text NOT NULL,
  feature_slug    text NOT NULL,
  preconditions   text,
  setup_hook      text,           -- script path, optional
  teardown_hook   text,
  regression_tag  text,           -- 'regression' | 'smoke' | NULL
  created_at      timestamptz NOT NULL DEFAULT now()
)
ALTER TABLE scenarios ADD COLUMN suite_id uuid REFERENCES test_suites(id);
ALTER TABLE runs       ADD COLUMN test_plan_path text;
```

### Generation rules
- Plan is generated **deterministically** from inputs first; AI is
  asked only for the optional `approach` narrative paragraph.
- If no AI provider is enabled, `approach` falls back to a template
  derived from `types` + `levels`.
- Suites: one per analysed page; collision (same `feature_slug`)
  appends a counter.

## Consequences
- Reports can claim ISTQB alignment without bespoke per-customer
  templates.
- Plans are diff-able (deterministic generation given identical input).
- DB carries the lightweight grouping; full Plan stays on disk for
  archival.

## Alternatives considered
- Embed full Plan as a JSON column on `runs` — rejected: bloat,
  versioning headache, complicates DB backups.
- Generate Plan entirely with AI — rejected: non-deterministic,
  expensive, hard to audit.
