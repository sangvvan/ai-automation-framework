import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { CrawlConfig } from "../validation/sitemap";
import { TestLevel } from "../validation";

export const WorkflowRole = z.object({
  name: z.string().min(1),
  authRecipe: z.string().min(1).optional(),
  storageState: z.string().min(1).optional(),
  allowCaptcha: z.boolean().default(false),
});
export type WorkflowRole = z.infer<typeof WorkflowRole>;

/**
 * Non-functional toggles a workflow can opt-in. Defaults are off so a
 * vanilla workflow YAML stays cheap; teams that want full ISTQB coverage
 * flip these on per project.
 */
export const WorkflowNonFunctional = z
  .object({
    a11y: z.boolean().default(false),
    vitals: z.boolean().default(false),
    securityHeaders: z.boolean().default(false),
    a11yFailOn: z
      .array(z.enum(["minor", "moderate", "serious", "critical"]))
      .default([]),
  })
  .default({});

export const WorkflowInput = z.object({
  project: z.string().min(1),
  baseUrl: z.string().url(),
  roles: z.array(WorkflowRole).min(1).default([{ name: "default" }]),
  crawl: CrawlConfig.partial().default({}),
  generation: z
    .object({
      outputDir: z.string().min(1).default("tests/generated"),
      /** Total functional scenario ceiling per page (legacy, overridden by scenariosPerTechnique). */
      maxScenariosPerPage: z.number().int().positive().optional(),
      /**
       * Scenarios requested per ISTQB technique.
       * Each of the 8 techniques gets this many scenarios (not divided from a total).
       * Recommended: 3 for Ollama, 5 for cloud.
       */
      scenariosPerTechnique: z.number().int().positive().optional(),
      /** Scenarios per non-functional category (a11y, security, perf, …). Default: 2. */
      scenariosPerNfCategory: z.number().int().positive().optional(),
      /**
       * Non-functional categories to generate. Set to [] to disable.
       * Default (omitted): all 5 categories.
       */
      nonFunctionalCategories: z
        .array(z.enum(["accessibility", "security", "performance", "usability", "compatibility"]))
        .optional(),
      /** Disable all non-functional generation. */
      skipNonFunctional: z.boolean().default(false),
      categories: z.array(z.string().min(1)).optional(),
      fallbackSmoke: z.boolean().default(true),
      /** Emit Page Object Model helper classes alongside .spec.ts files */
      emitPom: z.boolean().default(false),
      /** Override scripts output directory */
      scriptsDir: z.string().min(1).optional(),
    })
    .default({}),
  run: z
    .object({
      captureScreenshotOnSuccess: z.boolean().optional(),
      suiteTag: z.string().min(1).optional(),
      /** ISTQB test level surfaced in TestPlan + reports (REQ-011). */
      testLevel: TestLevel.optional(),
      /** Comma-separated browsers list (REQ-013). */
      browsers: z
        .array(z.enum(["chromium", "firefox", "webkit"]))
        .default(["chromium"]),
      /** Locales loop (REQ-013). */
      locales: z.array(z.string().min(1)).default([]),
      /** Non-functional post-checks (REQ-013). */
      nonFunctional: WorkflowNonFunctional,
      /** Emit a JUnit XML alongside JSON/HTML (REQ-015). */
      junit: z.boolean().default(true),
      /** Generate a TestPlan artefact per run (REQ-011). */
      testPlan: z.boolean().default(true),
      /** Auto-insert defects on failed scenarios when DB available (REQ-017). */
      persistDefects: z.boolean().default(true),
      /** Post a GitHub PR comment when GITHUB_* env present (REQ-015). */
      prComment: z.boolean().default(true),
    })
    .default({}),
});
export type WorkflowInput = z.infer<typeof WorkflowInput>;

export class WorkflowConfigError extends Error {
  constructor(
    message: string,
    readonly issues?: z.ZodIssue[],
  ) {
    super(message);
    this.name = "WorkflowConfigError";
  }
}

export async function readWorkflowInput(filePath: string): Promise<WorkflowInput> {
  const raw = await readFile(filePath, "utf8");
  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (err) {
    throw new WorkflowConfigError(`Failed to parse workflow YAML: ${(err as Error).message}`);
  }
  const parsed = WorkflowInput.safeParse(data);
  if (!parsed.success) {
    throw new WorkflowConfigError(formatIssues(parsed.error.issues), parsed.error.issues);
  }
  return parsed.data;
}

export function safePathSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "default";
}

function formatIssues(issues: z.ZodIssue[]): string {
  return issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}
