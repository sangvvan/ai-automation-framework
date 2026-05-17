---
id: ADR-002
title: Canonical Zod schemas for PageAnalysis, Scenario, RunSummary
status: accepted
date: 2026-05-17
deciders: planning agent
---

# ADR-002 — Canonical data shapes

## Context
Every agent in the pipeline produces or consumes structured data. We need
versioned, Zod-validated shapes to keep agents loosely coupled.

## Decision
Schemas live in `app/lib/validation/` and are imported by every layer.

### Locator
```ts
Locator = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("role"), role: AriaRole, name: z.string().optional() }),
  z.object({ kind: z.literal("label"), text: z.string() }),
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("testId"), value: z.string() }),
]);
```

### PageElement
```ts
PageElement = z.object({
  id: z.string(),                 // stable hash of locator + tag
  tag: z.string(),                // 'button' | 'input' | …
  type: z.string().optional(),    // input type
  locator: Locator,
  accessibleName: z.string().optional(),
  isRequired: z.boolean().default(false),
  isVisible: z.boolean().default(true),
  isDisabled: z.boolean().default(false),
  isSensitive: z.boolean().default(false), // password/pii hint
  attributes: z.record(z.string()).optional(),
});
```

### PageAnalysis
```ts
PageAnalysis = z.object({
  url: z.string().url(),
  finalUrl: z.string().url(),
  title: z.string(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  capturedAt: z.string().datetime(),
  screenshotPath: z.string(),
  elements: z.array(PageElement),
  forms: z.array(z.object({ name: z.string().optional(), fields: z.array(z.string()) })),
  navigation: z.array(z.object({ name: z.string(), href: z.string() })),
  consoleErrors: z.array(z.string()).default([]),
});
```

### Action / Step / Scenario
```ts
Action = z.discriminatedUnion("keyword", [
  z.object({ keyword: z.literal("open_page"), url: z.string().url() }),
  z.object({ keyword: z.literal("click"),   target: Locator }),
  z.object({ keyword: z.literal("fill"),    target: Locator, value: z.string() }),
  z.object({ keyword: z.literal("select"),  target: Locator, value: z.string() }),
  z.object({ keyword: z.literal("verify_text"), target: Locator.optional(), text: z.string() }),
  z.object({ keyword: z.literal("verify_url"),  pattern: z.string() }),
  z.object({ keyword: z.literal("wait_for"),    target: Locator }),
]);

ScenarioStep = z.object({
  index: z.number().int().nonnegative(),
  action: Action,
  description: z.string(),
});

ExpectedResult = z.object({
  url: z.string().optional(),
  text: z.string().optional(),
  visibleLocator: Locator.optional(),
});

ExecutableScenario = z.object({
  id: z.string(),                       // TC_*-derived or generated
  title: z.string(),
  type: z.enum(["positive","negative","required-field","boundary",
                "navigation","ui","error-handling","accessibility","security"]),
  priority: z.enum(["P1","P2","P3"]),
  pageUrl: z.string().url(),
  steps: z.array(ScenarioStep).min(1),
  expectedResult: ExpectedResult,
  origin: z.enum(["testcase-yaml","testcase-md","ai-generated","approved"]),
  warnings: z.array(z.object({ stepIndex: z.number(), reason: z.string() })).default([]),
});
```

### Result shapes
```ts
StepResult = z.object({
  index: z.number(), status: z.enum(["passed","failed","skipped"]),
  durationMs: z.number(), reason: z.string().optional(),
  screenshotPath: z.string().optional(),
});

ScenarioResult = z.object({
  scenarioId: z.string(), status: z.enum(["passed","failed","skipped","error"]),
  steps: z.array(StepResult), startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(), tracePath: z.string().optional(),
  screenshotPath: z.string().optional(),
  consoleMessages: z.array(z.object({ level: z.string(), message: z.string() })).default([]),
});

ValidationResult = z.object({
  scenarioId: z.string(), status: z.enum(["passed","failed"]),
  checks: z.array(z.object({ name: z.string(), status: z.enum(["passed","failed","warn"]),
                             detail: z.string().optional() })),
  failureReason: z.string().optional(),
  suggestedDefect: z.object({
    summary: z.string(), stepsToReproduce: z.array(z.string()),
    evidenceLinks: z.array(z.string()), severity: z.enum(["low","med","high"]),
  }).optional(),
});

RunSummary = z.object({
  runId: z.string(), mode: z.enum(["testcase","explore"]),
  app: z.string().optional(), startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  totals: z.object({ total: z.number(), passed: z.number(),
                     failed: z.number(), skipped: z.number() }),
  scenarios: z.array(z.object({
    scenarioId: z.string(), title: z.string(),
    result: ScenarioResult, validation: ValidationResult,
  })),
  environment: z.record(z.string()).default({}),
});
```

## Consequences
- Every boundary is typed and validated; no untyped JSON crosses agents.
- Reports and CLI snapshots are forward-compatible (add optional fields).
- Auditing AI output is enforced — generation must round-trip through these schemas.

## Alternatives considered
- Protobuf / JSON-Schema: heavier toolchain; rejected for MVP.
