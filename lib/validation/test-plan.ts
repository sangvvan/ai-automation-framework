import { z } from "zod";
import { TestLevel } from "./result";

export const RiskItem = z.object({
  description: z.string().min(1),
  likelihood: z.enum(["low", "med", "high"]),
  impact: z.enum(["low", "med", "high"]),
  mitigation: z.string().optional(),
});
export type RiskItem = z.infer<typeof RiskItem>;

export const TestItem = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  routePattern: z.string().optional(),
});
export type TestItem = z.infer<typeof TestItem>;

export const TraceabilityRow = z.object({
  reqId: z.string().min(1),
  testCondition: z.string().min(1),
  testCaseIds: z.array(z.string()),
  runId: z.string().min(1),
  defectIds: z.array(z.string()).default([]),
});
export type TraceabilityRow = z.infer<typeof TraceabilityRow>;

export const TestPlan = z.object({
  id: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  app: z.string().min(1),
  scope: z.object({
    inScope: z.array(z.string()),
    outOfScope: z.array(z.string()).default([]),
  }),
  testItems: z.array(TestItem),
  levels: z.array(TestLevel).min(1),
  types: z.array(
    z.enum([
      "functional",
      "accessibility",
      "performance",
      "security",
      "compatibility",
      "usability",
      "i18n",
    ]),
  ),
  approach: z.string().min(1),
  entryCriteria: z.array(z.string()),
  exitCriteria: z.array(z.string()),
  risks: z.array(RiskItem),
  schedule: z.object({
    plannedStart: z.string().datetime({ offset: true }).optional(),
    plannedEnd: z.string().datetime({ offset: true }).optional(),
    actualStart: z.string().datetime({ offset: true }),
    actualEnd: z.string().datetime({ offset: true }).optional(),
  }),
  resources: z.object({
    automation: z.string().default("ai-test framework"),
    aiProviders: z.array(z.string()).default([]),
    browsers: z.array(z.string()).default(["chromium"]),
    locales: z.array(z.string()).default(["en"]),
  }),
  deliverables: z.array(z.string()),
  traceabilityMatrix: z.array(TraceabilityRow).default([]),
});
export type TestPlan = z.infer<typeof TestPlan>;
