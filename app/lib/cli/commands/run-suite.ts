import { loadConfig } from "../../config";
import { flagBool, flagString } from "../args";
import type { CliCommand } from "../commands";
import { runTestCaseSuite } from "../../workflow/run-suite";

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
    ],
  },
  run: async (args) => {
    const casesDir = flagString(args, "cases-dir");
    if (!casesDir) {
      process.stderr.write("Missing --cases-dir\n");
      return 1;
    }

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
    });

    process.stdout.write(
      `\n✓ Run ${result.runId} finished — total=${result.totals.total} passed=${result.totals.passed} failed=${result.totals.failed} skipped=${result.totals.skipped}\n`,
    );
    process.stdout.write(`Files run: ${result.filesRun.length}\n`);
    if (result.filesSkipped.length) {
      process.stdout.write(`Files skipped: ${result.filesSkipped.length}\n`);
    }
    process.stdout.write(`JSON report: ${result.jsonPath}\n`);
    process.stdout.write(`HTML report: ${result.htmlPath}\n`);
    if (result.persistenceWarning) {
      process.stderr.write(`Note: DB persistence skipped (${result.persistenceWarning}).\n`);
    }
    return result.totals.failed > 0 ? 1 : 0;
  },
};
