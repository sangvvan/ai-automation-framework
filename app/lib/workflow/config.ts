import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { CrawlConfig } from "../validation/sitemap";

export const WorkflowRole = z.object({
  name: z.string().min(1),
  authRecipe: z.string().min(1).optional(),
  storageState: z.string().min(1).optional(),
  allowCaptcha: z.boolean().default(false),
});
export type WorkflowRole = z.infer<typeof WorkflowRole>;

export const WorkflowInput = z.object({
  project: z.string().min(1),
  baseUrl: z.string().url(),
  roles: z.array(WorkflowRole).min(1).default([{ name: "default" }]),
  crawl: CrawlConfig.partial().default({}),
  generation: z
    .object({
      outputDir: z.string().min(1).default("tests/generated"),
      maxScenariosPerPage: z.number().int().positive().optional(),
      categories: z.array(z.string().min(1)).optional(),
      fallbackSmoke: z.boolean().default(true),
    })
    .default({}),
  run: z
    .object({
      captureScreenshotOnSuccess: z.boolean().optional(),
      suiteTag: z.string().min(1).optional(),
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
