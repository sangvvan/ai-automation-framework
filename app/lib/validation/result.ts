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
});
export type ScenarioResult = z.infer<typeof ScenarioResult>;

export const CheckSeverity = z.enum(["passed", "failed", "warn"]);
export type CheckSeverity = z.infer<typeof CheckSeverity>;

export const ValidationCheck = z.object({
  name: z.string(),
  status: CheckSeverity,
  detail: z.string().optional(),
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

export const RunSummary = z.object({
  runId: z.string().min(1),
  mode: RunMode,
  app: z.string().optional(),
  suiteTag: z.string().optional(),
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
});
export type RunSummary = z.infer<typeof RunSummary>;
