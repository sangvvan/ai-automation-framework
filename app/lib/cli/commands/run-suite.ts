import { loadConfig } from "../../config";
import { flagBool, flagString } from "../args";
import type { CliCommand } from "../commands";
import { runTestCaseSuite } from "../../workflow/run-suite";
import type { BrowserName } from "../../browser/launcher";

export const runSuiteCommand: CliCommand = {
  help: {
    name: "run-suite",
    summary: "Run a directory of YAML/Markdown test cases and publish one report.",
    example:
      "ai-test run-suite --cases-dir tests/generated/my-app/admin --site-map reports/sitemaps/C-...json",
    options: [
      { flag: "--cases-dir", description: "Directory containing .yaml/.yml/.md test cases (required)" },
      { flag: "--site-map", description: "Optional SiteMap JSON used to filter cases" },
      { flag: "--storage-state", description: "Storage-state JSON for authenticated pages" },
      { flag: "--project", description: "Project label" },
      { flag: "--role", description: "Role label" },
      { flag: "--suite-tag", description: "Regression diff suite tag" },
      { flag: "--capture-screenshot-on-success", description: "Capture step screenshots on pass" },
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
    const casesDir = flagString(args, "cases-dir");
    if (!casesDir) {
      process.stderr.write("Missing --cases-dir\n");
      return 1;
    }

    const browsersFlag = flagString(args, "browsers");
    const browsers = browsersFlag
      ? (browsersFlag.split(",").map((s) => s.trim()).filter(Boolean) as BrowserName[])
      : undefined;
    const localesFlag = flagString(args, "locales");
    const locales = localesFlag
      ? localesFlag.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    const result = await runTestCaseSuite({
      cfg: loadConfig(),
      casesDir,
      siteMapPath: flagString(args, "site-map"),
      storageStatePath: flagString(args, "storage-state"),
      project: flagString(args, "project"),
      role: flagString(args, "role"),
      suiteTag: flagString(args, "suite-tag"),
      captureScreenshotOnSuccess:
        args.flags["capture-screenshot-on-success"] === undefined
          ? undefined
          : flagBool(args, "capture-screenshot-on-success", false),
      testLevel: flagString(args, "test-level") as
        | "unit" | "component" | "integration" | "system" | "acceptance"
        | undefined,
      browsers,
      locales,
      nonFunctional: {
        a11y: !!args.flags["a11y"],
        vitals: !!args.flags["vitals"],
        securityHeaders: !!args.flags["security-headers"],
      },
      junit: !args.flags["no-junit"],
      testPlan: !args.flags["no-test-plan"],
      persistDefects: !args.flags["no-defects"],
      prComment: !args.flags["no-pr-comment"],
    });

    process.stdout.write(
      `\n✓ Run ${result.runId} finished — total=${result.totals.total} passed=${result.totals.passed} failed=${result.totals.failed} skipped=${result.totals.skipped}\n`,
    );
    process.stdout.write(`Files run: ${result.filesRun.length}\n`);
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
