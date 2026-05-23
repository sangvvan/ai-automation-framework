import path from "node:path";
import { randomBytes } from "node:crypto";
import { loadConfig } from "../../config";
import { runAuthRecipe } from "../../auth/execute-auth";
import { discoverSiteMap } from "../../crawler/discover";
import { crawlsRepo } from "../../db/crawls";
import { CrawlConfig } from "../../validation/sitemap";
import { generateTestCasesFromSiteMap } from "../../workflow/generate";
import {
  readWorkflowInput,
  safePathSegment,
  WorkflowConfigError,
} from "../../workflow/config";
import { runTestCaseSuite } from "../../workflow/run-suite";
import { flagBool, flagString } from "../args";
import { formatPreflight, runPreflight } from "../preflight";
import { BudgetExceededError } from "../../ai/provider";
import {
  writeWorkflowAggregate,
  type RoleRunBrief,
  type WorkflowAggregate,
} from "../../reporter/workflow-aggregate";
import type { CliCommand } from "../commands";

export const workflowCommand: CliCommand = {
  help: {
    name: "workflow",
    summary: "Run auth, crawl, test-case generation, execution, and report per role.",
    example: "ai-test workflow --input inputs/projects/my-app.yaml",
    options: [
      { flag: "--input", description: "Workflow YAML input file (required)" },
      { flag: "--skip-preflight", description: "Skip P0 environment checks (boolean)" },
    ],
  },
  run: async (args) => {
    const inputPath = flagString(args, "input");
    if (!inputPath) {
      process.stderr.write("Missing --input\n");
      return 1;
    }

    // P0 — preflight (env, config, providers, browser, optional DB).
    if (!flagBool(args, "skip-preflight")) {
      const preflight = await runPreflight({
        requireBrowser: true,
        expectGithubEnv: true,
        pingDatabase: true,
      });
      process.stdout.write(formatPreflight(preflight) + "\n");
      if (preflight.status === "failed") return preflight.exitCode;
    }

    let input;
    try {
      input = await readWorkflowInput(inputPath);
    } catch (err) {
      if (err instanceof WorkflowConfigError) {
        process.stderr.write(`Workflow config error: ${err.message}\n`);
        return 2;
      }
      throw err;
    }
    const cfg = loadConfig();
    const projectKey = safePathSegment(input.project);
    const workflowStartedAt = new Date();
    const workflowId = `W-${workflowStartedAt
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14)}-${randomBytes(2).toString("hex")}`;
    let hasFailures = false;
    let hasOrchestrationError = false;
    const roleBriefs: RoleRunBrief[] = [];

    process.stdout.write(`Workflow: ${input.project} (${workflowId})\n`);

    for (const role of input.roles) {
      const roleKey = safePathSegment(role.name);
      process.stdout.write(`\nRole: ${role.name}\n`);

      let storageStatePath = role.storageState;
      if (role.authRecipe) {
        const outputStorage =
          storageStatePath ??
          path.join("reports", "auth", projectKey, `${roleKey}.storage-state.json`);
        try {
          const auth = await runAuthRecipe({
            recipePath: role.authRecipe,
            storageStatePath: outputStorage,
            allowCaptcha: role.allowCaptcha,
          });
          storageStatePath = auth.storageStatePath;
          process.stdout.write(`  auth: ${storageStatePath}\n`);
        } catch (err) {
          process.stderr.write(`  auth failed: ${(err as Error).message}\n`);
          return 3;
        }
      } else if (storageStatePath) {
        process.stdout.write(`  auth: using existing ${storageStatePath}\n`);
      } else {
        process.stdout.write("  auth: anonymous\n");
      }

      const crawlConfig = CrawlConfig.parse(input.crawl);
      const siteMap = await discoverSiteMap({
        entryUrl: input.baseUrl,
        config: crawlConfig,
        storageStatePath,
      });
      const siteMapPath = path.join("reports", "sitemaps", `${siteMap.crawlId}.json`);
      await crawlsRepo.insert(siteMap, siteMapPath).catch((err) => {
        process.stderr.write(`  note: crawl DB persistence skipped (${(err as Error).message})\n`);
      });
      process.stdout.write(
        `  crawl: ${siteMap.totals.unique} page(s), sitemap ${siteMapPath}\n`,
      );

      const casesDir = path.join(input.generation.outputDir, projectKey, roleKey);
      const generated = await generateTestCasesFromSiteMap({
        siteMapPath,
        cfg,
        project: input.project,
        role: role.name,
        outputDir: casesDir,
        maxScenariosPerPage: input.generation.maxScenariosPerPage,
        categories: input.generation.categories,
        storageStatePath,
        fallbackSmoke: input.generation.fallbackSmoke,
      });
      process.stdout.write(
        `  generate: ${generated.files.length} file(s), manifest ${generated.manifestPath}\n`,
      );
      if (generated.errors.length) {
        process.stderr.write(`  generate skipped ${generated.errors.length} page(s)\n`);
      }
      if (!generated.files.length) {
        hasOrchestrationError = true;
        continue;
      }

      let result;
      const roleStartedAt = Date.now();
      try {
        result = await runTestCaseSuite({
          cfg,
          casesDir: generated.casesDir,
          siteMapPath,
          storageStatePath,
          project: input.project,
          role: role.name,
          suiteTag: input.run.suiteTag ?? `${projectKey}-${roleKey}`,
          captureScreenshotOnSuccess: input.run.captureScreenshotOnSuccess,
          testLevel: input.run.testLevel,
          browsers: input.run.browsers,
          locales: input.run.locales.length ? input.run.locales : undefined,
          nonFunctional: input.run.nonFunctional,
          junit: input.run.junit,
          testPlan: input.run.testPlan,
          persistDefects: input.run.persistDefects,
          prComment: input.run.prComment,
        });
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          process.stderr.write(`  run halted: AI token budget exceeded (${err.message})\n`);
          return 4;
        }
        throw err;
      }
      roleBriefs.push({
        roleName: role.name,
        runId: result.runId,
        totals: result.totals,
        htmlPath: result.htmlPath,
        junitPath: result.junitPath,
        testPlanPath: result.testPlanPath,
        defectsInserted: result.defectsInserted,
        durationMs: Date.now() - roleStartedAt,
        prCommentUrl: result.prCommentUrl ?? undefined,
      });
      process.stdout.write(
        `  run: ${result.runId} total=${result.totals.total} passed=${result.totals.passed} failed=${result.totals.failed}\n`,
      );
      process.stdout.write(`  HTML:    ${result.htmlPath}\n`);
      if (result.junitPath) process.stdout.write(`  JUnit:   ${result.junitPath}\n`);
      if (result.testPlanPath) process.stdout.write(`  TestPlan: ${result.testPlanPath}\n`);
      if (result.defectsInserted > 0) {
        process.stdout.write(`  defects: ${result.defectsInserted} persisted\n`);
      }
      if (result.prCommentUrl) {
        process.stdout.write(`  PR comment: ${result.prCommentUrl}\n`);
      }
      if (result.persistenceWarning) {
        process.stderr.write(
          `  note: run DB persistence skipped (${result.persistenceWarning})\n`,
        );
      }
      if (result.totals.failed > 0) hasFailures = true;
    }

    // Cross-role aggregate report — always emit when ≥1 role ran.
    if (roleBriefs.length > 0) {
      const agg: WorkflowAggregate = {
        workflowId,
        project: input.project,
        baseUrl: input.baseUrl,
        startedAt: workflowStartedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        roles: roleBriefs,
        totals: roleBriefs.reduce(
          (acc, r) => ({
            total: acc.total + r.totals.total,
            passed: acc.passed + r.totals.passed,
            failed: acc.failed + r.totals.failed,
            skipped: acc.skipped + r.totals.skipped,
          }),
          { total: 0, passed: 0, failed: 0, skipped: 0 },
        ),
      };
      try {
        const { htmlPath, summaryPath } = await writeWorkflowAggregate(agg, {
          reportsDir: cfg.reportsDir,
        });
        process.stdout.write(
          `\nWorkflow ${workflowId} — ${agg.roles.length} role${
            agg.roles.length === 1 ? "" : "s"
          }, totals=${agg.totals.passed}/${agg.totals.total} passed\n`,
        );
        process.stdout.write(`  aggregate HTML:    ${htmlPath}\n`);
        process.stdout.write(`  aggregate JSON:    ${summaryPath}\n`);
      } catch (err) {
        process.stderr.write(`  note: aggregate report failed (${(err as Error).message})\n`);
      }
    }

    if (hasOrchestrationError) return 2;
    return hasFailures ? 1 : 0;
  },
};
