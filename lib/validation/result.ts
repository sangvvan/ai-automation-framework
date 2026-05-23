import { z } from "zod";
import { ExecutableScenario } from "./scenario";

export const StepStatus = z.enum(["passed", "failed", "skipped"]);
export type StepStatus = z.infer<typeof StepStatus>;

export const StepResult = z.object({
  index: z.number().int().nonnegative(),
  status: StepStatus,
  durationMs: z.number().nonnegative(),
  reason: z.string().optional(),
  screenshotPath: z.string().optional(),
});
export type StepResult = z.infer<typeof StepResult>;

export const ConsoleMessage = z.object({
  level: z.string(),
  message: z.string(),
});
export type ConsoleMessage = z.infer<typeof ConsoleMessage>;

export const ScenarioResultStatus = z.enum([
  "passed",
  "failed",
  "skipped",
  "error",
]);
export type ScenarioResultStatus = z.infer<typeof ScenarioResultStatus>;

export const A11yViolation = z.object({
  id: z.string(),
  impact: z.enum(["minor", "moderate", "serious", "critical"]),
  wcagLevel: z.enum(["A", "AA", "AAA"]),
  help: z.string(),
  helpUrl: z.string().optional(),
  nodes: z.array(z.string()).default([]),
});
export type A11yViolation = z.infer<typeof A11yViolation>;

export const WebVitals = z.object({
  lcpMs: z.number().nullable().default(null),
  cls: z.number().nullable().default(null),
  inpMs: z.number().nullable().default(null),
  ttfbMs: z.number().nullable().default(null),
  notMeasurable: z.boolean().default(false),
});
export type WebVitals = z.infer<typeof WebVitals>;

export const SecurityCheck = z.object({
  name: z.string(),
  status: z.enum(["passed", "failed", "warn"]),
  detail: z.string().optional(),
  severity: z.enum(["low", "med", "high"]).default("med"),
});
export type SecurityCheck = z.infer<typeof SecurityCheck>;

export const ScenarioResult = z.object({
  scenarioId: z.string().min(1),
  status: ScenarioResultStatus,
  steps: z.array(StepResult),
  startedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }),
  finalUrl: z.string().optional(),
  finalText: z.string().optional(),
  tracePath: z.string().optional(),
  screenshotPath: z.string().optional(),
  consoleMessages: z.array(ConsoleMessage).default([]),
  /** Browser used for this scenario run (REQ-013 multi-browser). */
  browser: z.string().optional(),
  /** Locale used (REQ-013 i18n). */
  locale: z.string().optional(),
  /** Non-functional results (REQ-013). */
  accessibilityViolations: z.array(A11yViolation).optional(),
  webVitals: WebVitals.optional(),
  securityChecks: z.array(SecurityCheck).optional(),
});
export type ScenarioResult = z.infer<typeof ScenarioResult>;

export const CheckSeverity = z.enum(["passed", "failed", "warn"]);
export type CheckSeverity = z.infer<typeof CheckSeverity>;

export const CheckCategory = z.enum([
  "functional",
  "a11y",
  "performance",
  "security",
  "compatibility",
  "i18n",
]);
export type CheckCategory = z.infer<typeof CheckCategory>;

export const ValidationCheck = z.object({
  name: z.string(),
  status: CheckSeverity,
  detail: z.string().optional(),
  category: CheckCategory.optional(),
});
export type ValidationCheck = z.infer<typeof ValidationCheck>;

export const SuggestedDefect = z.object({
  summary: z.string(),
  stepsToReproduce: z.array(z.string()),
  evidenceLinks: z.array(z.string()),
  severity: z.enum(["low", "med", "high"]),
});
export type SuggestedDefect = z.infer<typeof SuggestedDefect>;

export const ValidationResult = z.object({
  scenarioId: z.string().min(1),
  status: z.enum(["passed", "failed"]),
  checks: z.array(ValidationCheck),
  failureReason: z.string().optional(),
  suggestedDefect: SuggestedDefect.optional(),
});
export type ValidationResult = z.infer<typeof ValidationResult>;

export const RunMode = z.enum(["testcase", "explore"]);
export type RunMode = z.infer<typeof RunMode>;

/** ISTQB test level (REQ-011). */
export const TestLevel = z.enum([
  "unit",
  "component",
  "integration",
  "system",
  "acceptance",
]);
export type TestLevel = z.infer<typeof TestLevel>;

export const TechniqueCoverage = z.object({
  technique: z.string(),
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
});
export type TechniqueCoverage = z.infer<typeof TechniqueCoverage>;

export const RunSummary = z.object({
  runId: z.string().min(1),
  mode: RunMode,
  app: z.string().optional(),
  suiteTag: z.string().optional(),
  testLevel: TestLevel.optional(),
  startedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }),
  totals: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  scenarios: z.array(
    z.object({
      scenario: ExecutableScenario,
      result: ScenarioResult,
      validation: ValidationResult,
    }),
  ),
  environment: z.record(z.string()).default({}),
  /** Test Plan path on disk (REQ-011). */
  testPlanPath: z.string().optional(),
  /** Roll-up of design-technique coverage (REQ-012). */
  techniqueCoverage: z.array(TechniqueCoverage).optional(),
});
export type RunSummary = z.infer<typeof RunSummary>;
