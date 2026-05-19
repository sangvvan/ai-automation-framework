import path from "node:path";
import { loadConfig } from "../../config";
import { runAuthRecipe } from "../../auth/execute-auth";
import { discoverSiteMap } from "../../crawler/discover";
import { crawlsRepo } from "../../db/crawls";
import { CrawlConfig } from "../../validation/sitemap";
import { generateTestCasesFromSiteMap } from "../../workflow/generate";
import { readWorkflowInput, safePathSegment } from "../../workflow/config";
import { runTestCaseSuite } from "../../workflow/run-suite";
import { flagString } from "../args";
import type { CliCommand } from "../commands";

export const workflowCommand: CliCommand = {
  help: {
    name: "workflow",
    summary: "Run auth, crawl, test-case generation, execution, and report per role.",
    example: "ai-test workflow --input inputs/projects/my-app.yaml",
    options: [
      { flag: "--input", description: "Workflow YAML input file (required)" },
    ],
  },
  run: async (args) => {
    const inputPath = flagString(args, "input");
    if (!inputPath) {
      process.stderr.write("Missing --input\n");
      return 1;
    }

    const input = await readWorkflowInput(inputPath);
    const cfg = loadConfig();
    const projectKey = safePathSegment(input.project);
    let hasFailures = false;
    let hasOrchestrationError = false;

    process.stdout.write(`Workflow: ${input.project}\n`);

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

      const result = await runTestCaseSuite({
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

    if (hasOrchestrationError) return 2;
    return hasFailures ? 1 : 0;
  },
};
