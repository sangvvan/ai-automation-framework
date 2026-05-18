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
  z.object({
    keyword: z.literal("wait_for"),
    target: Locator.optional(),
    /** Wait strategy added in REQ-014. */
    strategy: z
      .enum(["visible", "network-idle", "mutation-stable", "route-change"])
      .optional(),
    /** For mutation-stable: how long DOM must be quiet (ms). */
    quietMs: z.number().int().positive().optional(),
  }),
  // Advanced interactions (REQ-016)
  z.object({
    keyword: z.literal("upload_file"),
    target: Locator,
    filePath: z.string().min(1),
  }),
  z.object({ keyword: z.literal("drag_drop"), source: Locator, target: Locator }),
  z.object({ keyword: z.literal("type_keyboard"), keys: z.string().min(1) }),
  z.object({ keyword: z.literal("scroll_to"), target: Locator }),
  // Visual regression (REQ-014)
  z.object({
    keyword: z.literal("verify_screenshot"),
    name: z.string().min(1),
    threshold: z.number().min(0).max(1).optional(),
  }),
]);
export type Action = z.infer<typeof Action>;

export const ScenarioStep = z.object({
  index: z.number().int().nonnegative(),
  action: Action,
  description: z.string(),
  resolved: z.boolean().default(true),
});
export type ScenarioStep = z.infer<typeof ScenarioStep>;

/**
 * Extended assertion vocabulary (REQ-014). Each field is independent;
 * the validator dispatches one ValidationCheck per supplied field.
 */
export const AttributeAssertion = z.object({
  target: Locator,
  name: z.string().min(1),
  equals: z.string().optional(),
  contains: z.string().optional(),
});
export type AttributeAssertion = z.infer<typeof AttributeAssertion>;

export const ChildCountAssertion = z.object({
  target: Locator,
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().nonnegative().optional(),
});
export type ChildCountAssertion = z.infer<typeof ChildCountAssertion>;

export const ExpectedResult = z.object({
  url: z.string().optional(),
  text: z.string().optional(),
  visibleLocator: Locator.optional(),
  urlNotContains: z.string().optional(),
  textNotContains: z.string().optional(),
  visibleLocators: z.array(Locator).optional(),
  notVisibleLocators: z.array(Locator).optional(),
  attribute: AttributeAssertion.optional(),
  childCount: ChildCountAssertion.optional(),
});
export type ExpectedResult = z.infer<typeof ExpectedResult>;

/**
 * Test TYPE — what aspect of the application is being verified (ISO/IEC
 * 25010 alignment). Orthogonal to design technique.
 */
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
  "performance",
  "compatibility",
  "usability",
  "i18n",
]);
export type ScenarioType = z.infer<typeof ScenarioType>;

/**
 * ISTQB-CTFL design technique (REQ-012). Tagged on every scenario so
 * coverage by technique is reportable.
 */
export const DesignTechnique = z.enum([
  "equivalence-partition",
  "boundary-value",
  "decision-table",
  "state-transition",
  "use-case",
  "pairwise",
  "error-guessing",
  "exploratory-charter",
]);
export type DesignTechnique = z.infer<typeof DesignTechnique>;

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
  /** ISTQB technique that produced this scenario (REQ-012). */
  designTechnique: DesignTechnique.optional(),
  /** Optional Test Suite the scenario belongs to (REQ-011). */
  suiteId: z.string().uuid().optional(),
});
export type ExecutableScenario = z.infer<typeof ExecutableScenario>;
