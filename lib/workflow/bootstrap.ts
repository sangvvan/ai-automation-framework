/**
 * Bootstrap helpers for the `ai-test quick` wrapper.
 *
 * Given just a URL (+ optional credentials, + optional specs folder),
 * synthesise the artefacts the existing workflow command expects:
 *   - inputs/projects/<project>.yaml   (workflow input)
 *   - inputs/auth/<project>.yaml       (only when credentials supplied)
 *   - docs/requirements/AUTO-<project>.md  (only when --specs absent
 *                                            and AI provider available)
 *
 * Then the caller invokes the existing `ai-test workflow` engine — no
 * duplication of pipeline logic here.
 */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { analyzePage } from "../analyzer/analyze";
import { detectLoginForm, AmbiguousLoginFormError } from "../auth/detect-login";
import { buildProvider } from "../ai/factory";
import type { FrameworkConfig } from "../config";
import { safePathSegment } from "../workflow/config";

export interface BootstrapInputs {
  url: string;
  project?: string;
  username?: string;
  password?: string;
  /** Existing specs folder to copy into docs/requirements/. */
  specsDir?: string;
  /** Auto-generate a draft PS doc from the entry page when no specs given. */
  autoGenerateSpecs?: boolean;
  cfg: FrameworkConfig;
}

export interface BootstrapResult {
  project: string;
  baseUrl: string;
  workflowYamlPath: string;
  authRecipePath?: string;
  generatedSpecsPath?: string;
  copiedSpecsCount?: number;
  notes: string[];
}

export async function bootstrap(opts: BootstrapInputs): Promise<BootstrapResult> {
  const baseUrl = new URL(opts.url).origin;
  const project = opts.project ?? safePathSegment(new URL(opts.url).hostname);
  const notes: string[] = [];

  // 1. Specs — copy supplied folder or auto-generate a draft.
  let copiedSpecsCount: number | undefined;
  let generatedSpecsPath: string | undefined;
  if (opts.specsDir) {
    copiedSpecsCount = await copySpecsFolder(opts.specsDir, "docs/requirements");
    notes.push(`Copied ${copiedSpecsCount} spec file(s) from ${opts.specsDir} → docs/requirements/`);
  } else if (opts.autoGenerateSpecs) {
    try {
      generatedSpecsPath = await autoGenerateSpecsFromUrl({
        url: opts.url,
        project,
        cfg: opts.cfg,
      });
      notes.push(`Auto-generated draft spec → ${generatedSpecsPath}`);
    } catch (err) {
      notes.push(`Spec auto-generation skipped: ${(err as Error).message}`);
    }
  } else {
    notes.push("No --specs and --auto-specs not requested; running without per-app spec docs.");
  }

  // 2. Auth recipe — only when credentials supplied.
  let authRecipePath: string | undefined;
  if (opts.username && opts.password) {
    try {
      authRecipePath = await bootstrapAuthRecipe({
        url: opts.url,
        project,
        cfg: opts.cfg,
      });
      notes.push(`Detected login form → ${authRecipePath}`);
      notes.push(`Recipe references env vars SITE_USERNAME / SITE_PASSWORD — values you supplied will be exported to the workflow process.`);
    } catch (err) {
      if (err instanceof AmbiguousLoginFormError) {
        notes.push(
          `Auto-detect failed (${err.message}); write inputs/auth/${project}.yaml by hand and re-run with --auth-recipe.`,
        );
      } else {
        throw err;
      }
    }
  } else {
    notes.push("No --username/--password; running as anonymous role only.");
  }

  // 3. Workflow YAML.
  const workflowYamlPath = await writeWorkflowYaml({
    project,
    baseUrl,
    authRecipePath,
  });
  notes.push(`Wrote workflow YAML → ${workflowYamlPath}`);

  return {
    project,
    baseUrl,
    workflowYamlPath,
    authRecipePath,
    generatedSpecsPath,
    copiedSpecsCount,
    notes,
  };
}

/**
 * Run the login-form detector against the URL and persist a YAML
 * recipe under inputs/auth/<project>.yaml referencing ${SITE_USERNAME}
 * and ${SITE_PASSWORD} env vars. Caller is responsible for exporting
 * the values into the workflow process.
 */
export async function bootstrapAuthRecipe(opts: {
  url: string;
  project: string;
  cfg: FrameworkConfig;
}): Promise<string> {
  const evidenceDir = path.join(opts.cfg.evidenceDir, "bootstrap", opts.project);
  await mkdir(evidenceDir, { recursive: true });
  const analysis = await analyzePage({
    url: opts.url,
    viewport: opts.cfg.runner.viewport,
    screenshotPath: path.join(evidenceDir, "login.png"),
    headless: opts.cfg.runner.headless,
    navigationTimeoutMs: opts.cfg.runner.navigationTimeoutMs,
  });
  const recipe = detectLoginForm(analysis, { recipeId: opts.project });
  const outPath = path.join("inputs", "auth", `${opts.project}.yaml`);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, stringifyYaml(recipe));
  return outPath;
}

/**
 * Generate inputs/projects/<project>.yaml with sensible defaults that
 * any of the existing knobs can be overridden by hand later.
 */
export async function writeWorkflowYaml(opts: {
  project: string;
  baseUrl: string;
  authRecipePath?: string;
}): Promise<string> {
  const projectKey = safePathSegment(opts.project);
  const yaml: Record<string, unknown> = {
    project: opts.project,
    baseUrl: opts.baseUrl,
    roles: opts.authRecipePath
      ? [
          { name: "anonymous" },
          { name: "authenticated", authRecipe: opts.authRecipePath },
        ]
      : [{ name: "anonymous" }],
    crawl: {
      maxPages: 25,
      maxDepth: 3,
      maxConcurrency: 2,
      perHostQps: 2,
      includeSubdomains: false,
      ignoreRobots: false,
    },
    generation: {
      outputDir: "tests/generated",
      maxScenariosPerPage: 14,
      fallbackSmoke: true,
    },
    run: {
      testLevel: "system",
      browsers: ["chromium"],
      locales: [],
      nonFunctional: {
        a11y: true,
        a11yFailOn: [],
        vitals: true,
        securityHeaders: true,
      },
      junit: true,
      testPlan: true,
      persistDefects: true,
      prComment: true,
      suiteTag: projectKey,
    },
  };
  const outPath = path.join("inputs", "projects", `${projectKey}.yaml`);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, stringifyYaml(yaml));
  return outPath;
}

/**
 * Copy a flat folder of spec files (*.md, *.yaml) into the framework's
 * docs/requirements/ folder so they're picked up by TestPlan
 * traceability and (future) per-AC scenario grounding.
 */
export async function copySpecsFolder(srcDir: string, destDir: string): Promise<number> {
  await mkdir(destDir, { recursive: true });
  let copied = 0;
  for await (const file of walkFiles(srcDir)) {
    if (!/\.(md|markdown|ya?ml|txt)$/i.test(file)) continue;
    const dest = path.join(destDir, path.basename(file));
    await writeFile(dest, await readFile(file, "utf8"));
    copied++;
  }
  return copied;
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
}

/**
 * Use the configured AI provider to draft a tiny problem-statement
 * file under docs/requirements/PS-AUTO-<project>.md grounded on the
 * entry page's analysis. Best-effort: if the provider chain has no
 * working backend, the helper throws and the caller logs a note.
 */
async function autoGenerateSpecsFromUrl(opts: {
  url: string;
  project: string;
  cfg: FrameworkConfig;
}): Promise<string> {
  const evidenceDir = path.join(opts.cfg.evidenceDir, "bootstrap", opts.project);
  await mkdir(evidenceDir, { recursive: true });
  const analysis = await analyzePage({
    url: opts.url,
    viewport: opts.cfg.runner.viewport,
    screenshotPath: path.join(evidenceDir, "entry.png"),
    headless: opts.cfg.runner.headless,
    navigationTimeoutMs: opts.cfg.runner.navigationTimeoutMs,
  });
  const provider = buildProvider({
    config: opts.cfg,
    role: "design",
    tracePath: path.join(evidenceDir, "ai-trace.jsonl"),
  });

  const { z } = await import("zod");
  const Spec = z.object({
    summary: z.string().min(1),
    requirements: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          why: z.string().min(1),
        }),
      )
      .min(1),
    risks: z.array(z.string()).default([]),
  });

  const data = await provider.generateStructured({
    systemPrompt:
      "You read a PageAnalysis and write a tiny problem statement. " +
      "Respond JSON with { summary, requirements:[{id,title,why}], risks:[] }. " +
      "Use REQ-001, REQ-002, … for ids. Keep it concise (3-7 requirements).",
    userPrompt: JSON.stringify(
      {
        url: analysis.url,
        title: analysis.title,
        elements: analysis.elements
          .filter((e) => e.isVisible)
          .map((e) => ({ tag: e.tag, type: e.type, name: e.accessibleName })),
        forms: analysis.forms,
        navigation: analysis.navigation,
      },
      null,
      2,
    ),
    schema: Spec,
  });

  const outPath = path.join("docs", "requirements", `PS-AUTO-${safePathSegment(opts.project)}.md`);
  await mkdir(path.dirname(outPath), { recursive: true });
  const md = renderAutoSpecMd(opts.url, opts.project, {
    summary: data.summary,
    requirements: data.requirements,
    risks: data.risks ?? [],
  });
  await writeFile(outPath, md);
  return outPath;
}

function renderAutoSpecMd(
  url: string,
  project: string,
  data: {
    summary: string;
    requirements: { id: string; title: string; why: string }[];
    risks: string[];
  },
): string {
  return `# PS-AUTO-${project} — auto-drafted problem statement

> Generated by \`ai-test quick\` from a PageAnalysis of <${url}>.
> Review and edit before relying on this for QA governance.

## Summary

${data.summary}

## Requirements

${data.requirements
  .map((r) => `### ${r.id} — ${r.title}\n\n${r.why}\n`)
  .join("\n")}

${
  data.risks.length
    ? `## Risks\n\n${data.risks.map((r) => `- ${r}`).join("\n")}\n`
    : ""
}
`;
}

// Silence unused-warning for stat (kept for future size-based filtering).
void stat;
void existsSync;
