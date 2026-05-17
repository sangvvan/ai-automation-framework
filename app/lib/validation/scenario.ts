import { z } from "zod";
import { Locator } from "./locator";

export const Action = z.discriminatedUnion("keyword", [
  z.object({ keyword: z.literal("open_page"), url: z.string().url() }),
  z.object({ keyword: z.literal("click"), target: Locator }),
  z.object({ keyword: z.literal("fill"), target: Locator, value: z.string() }),
  z.object({ keyword: z.literal("select"), target: Locator, value: z.string() }),
  z.object({
    keyword: z.literal("verify_text"),
    target: Locator.optional(),
    text: z.string().min(1),
  }),
  z.object({ keyword: z.literal("verify_url"), pattern: z.string().min(1) }),
  z.object({ keyword: z.literal("wait_for"), target: Locator }),
]);
export type Action = z.infer<typeof Action>;

export const ScenarioStep = z.object({
  index: z.number().int().nonnegative(),
  action: Action,
  description: z.string(),
  resolved: z.boolean().default(true),
});
export type ScenarioStep = z.infer<typeof ScenarioStep>;

export const ExpectedResult = z.object({
  url: z.string().optional(),
  text: z.string().optional(),
  visibleLocator: Locator.optional(),
});
export type ExpectedResult = z.infer<typeof ExpectedResult>;

export const ScenarioType = z.enum([
  "positive",
  "negative",
  "required-field",
  "boundary",
  "navigation",
  "ui",
  "error-handling",
  "accessibility",
  "security",
]);
export type ScenarioType = z.infer<typeof ScenarioType>;

export const Priority = z.enum(["P1", "P2", "P3"]);
export type Priority = z.infer<typeof Priority>;

export const ScenarioOrigin = z.enum([
  "testcase-yaml",
  "testcase-md",
  "ai-generated",
  "approved",
]);
export type ScenarioOrigin = z.infer<typeof ScenarioOrigin>;

export const ScenarioWarning = z.object({
  stepIndex: z.number().int().nonnegative(),
  reason: z.string(),
});
export type ScenarioWarning = z.infer<typeof ScenarioWarning>;

export const ExecutableScenario = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: ScenarioType,
  priority: Priority,
  pageUrl: z.string().url(),
  steps: z.array(ScenarioStep).min(1),
  expectedResult: ExpectedResult,
  origin: ScenarioOrigin,
  warnings: z.array(ScenarioWarning).default([]),
});
export type ExecutableScenario = z.infer<typeof ExecutableScenario>;
