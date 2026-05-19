import path from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "../../config";
import { flagBool, flagString } from "../args";
import type { CliCommand } from "../commands";
import { runTestCaseSuite } from "../../workflow/run-suite";
import type { BrowserName } from "../../browser/launcher";

/**
 * Shortcut over `ai-test run-suite --cases-dir tests/regression/<...>`.
 *
 * Use cases:
 *   ai-test regression                       # all of tests/regression
 *   ai-test regression --feature auth        # tests/regression/auth
 *   ai-test regression --suite-tag shop-customer  # custom diff tag
 *
 * All Sprint 5/6 toggles available (a11y / vitals / security-headers /
 * browsers / locales / budget / junit / testPlan / persistDefects /
 * prComment) — same surface as run-suite.
 */
export const regressionCommand: CliCommand = {
  help: {
    name: "regression",
    summary: "Re-run the approved/regression test corpus (shortcut over run-suite).",
    example: "ai-test regression --feature auth --browsers chromium,firefox",
    options: [
      {
        flag: "--root",
        description: "Override the regression root directory",
        default: "tests/regression",
      },
      {
        flag: "--feature",
        description: "Restrict to one feature subdirectory (under --root)",
      },
      { flag: "--storage-state", description: "Storage-state JSON for authenticated pages" },
      { flag: "--site-map", description: "Optional SiteMap JSON used to filter cases" },
      { flag: "--suite-tag", description: "Regression diff suite tag" },
      {
        flag: "--test-level",
        description: "ISTQB level: unit|component|integration|system|acceptance",
        default: "system",
      },
      {
        flag: "--browsers",
        description: "Comma-separated browsers: chromium,firefox,webkit",
        default: "chromium",
      },
      { flag: "--locales", description: "Comma-separated BCP-47 locales (e.g. en,vi,ja)" },
      { flag: "--a11y", description: "Run axe-core per scenario (boolean)" },
      { flag: "--vitals", description: "Capture Web Vitals per scenario (boolean)" },
      { flag: "--security-headers", description: "Validate response headers per nav (boolean)" },
      { flag: "--no-junit", description: "Skip JUnit XML output" },
      { flag: "--no-test-plan", description: "Skip TestPlan generation" },
      { flag: "--no-defects", description: "Skip defect persistence" },
      { flag: "--no-pr-comment", description: "Skip GitHub PR comment" },
    ],
  },
  run: async (args) => {
    const root = flagString(args, "root") ?? "tests/regression";
    const feature = flagString(args, "feature");
    const casesDir = feature ? path.join(root, feature) : root;

    if (!existsSync(casesDir)) {
      process.stderr.write(
        `regression: cases directory not found: ${casesDir}\n` +
          `Tip: promote scenarios via the Review UI (test-lead role) first.\n`,
      );
      return 2;
    }

    const browsersFlag = flagString(args, "browsers");
    const browsers = browsersFlag
      ? (browsersFlag.split(",").map((s) => s.trim()).filter(Boolean) as BrowserName[])
      : undefined;
    const localesFlag = flagString(args, "locales");
    const locales = localesFlag
      ? localesFlag.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    // Auto-derive a sensible default suite-tag for regression-diff
    // grouping (e.g. "regression:auth").
    const defaultTag = feature ? `regression:${feature}` : "regression";

    const result = await runTestCaseSuite({
      cfg: loadConfig(),
      casesDir,
      siteMapPath: flagString(args, "site-map"),
      storageStatePath: flagString(args, "storage-state"),
      project: "regression",
      role: feature ?? "all",
      suiteTag: flagString(args, "suite-tag") ?? defaultTag,
      testLevel: flagString(args, "test-level") as
        | "unit" | "component" | "integration" | "system" | "acceptance"
        | undefined,
      browsers,
      locales,
      nonFunctional: {
        a11y: flagBool(args, "a11y"),
        vitals: flagBool(args, "vitals"),
        securityHeaders: flagBool(args, "security-headers"),
      },
      junit: !args.flags["no-junit"],
      testPlan: !args.flags["no-test-plan"],
      persistDefects: !args.flags["no-defects"],
      prComment: !args.flags["no-pr-comment"],
    });

    process.stdout.write(
      `\n✓ Regression ${result.runId} — total=${result.totals.total} passed=${result.totals.passed} failed=${result.totals.failed} skipped=${result.totals.skipped}\n`,
    );
    process.stdout.write(`Cases dir:   ${casesDir}\n`);
    if (result.filesRun.length) {
      process.stdout.write(`Files run:   ${result.filesRun.length}\n`);
    }
    if (result.filesSkipped.length) {
      process.stdout.write(`Files skipped: ${result.filesSkipped.length}\n`);
    }
    process.stdout.write(`JSON report:  ${result.jsonPath}\n`);
    process.stdout.write(`HTML report:  ${result.htmlPath}\n`);
    if (result.junitPath) process.stdout.write(`JUnit XML:    ${result.junitPath}\n`);
    if (result.testPlanPath) process.stdout.write(`Test Plan:    ${result.testPlanPath}\n`);
    if (result.defectsInserted > 0) {
      process.stdout.write(`Defects:      ${result.defectsInserted} persisted\n`);
    }
    if (result.prCommentUrl) {
      process.stdout.write(`PR comment:   ${result.prCommentUrl}\n`);
    }
    if (result.persistenceWarning) {
      process.stderr.write(`Note: DB persistence skipped (${result.persistenceWarning}).\n`);
    }
    return result.totals.failed > 0 ? 1 : 0;
  },
};
