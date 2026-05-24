/**
 * CLI command: generate-scripts
 *
 * Converts a test-case manifest (produced by `ai-test generate`) into
 * Playwright TypeScript .spec.ts + POM .page.ts files.
 *
 * Output layout (always POM-based):
 *   <output-dir>/
 *     playwright.config.ts      ← ready to run with `npx playwright test`
 *     <page>.spec.ts            ← thin spec, imports POM class only
 *     pom/
 *       <page>.page.ts          ← POM class: locators + goto()
 *
 * Usage:
 *   ai-test generate-scripts --manifest tests/generated/my-app/admin/manifest.json
 *   ai-test generate-scripts --manifest ... --output-dir tests/e2e
 *   ai-test generate-scripts --manifest ... --overwrite-pom   # re-generate POM files
 */

import { flagBool, flagString } from "../args";
import type { CliCommand } from "../commands";
import { generateAutomationScripts } from "../../codegen/script-writer";

export const generateScriptsCommand: CliCommand = {
  help: {
    name: "generate-scripts",
    summary:
      "Convert YAML test-case files into Playwright .spec.ts + POM .page.ts automation scripts.",
    example:
      "ai-test generate-scripts --manifest tests/generated/my-app/admin/manifest.json",
    options: [
      {
        flag: "--manifest",
        description:
          "Path to the manifest.json produced by `ai-test generate` (required)",
      },
      {
        flag: "--output-dir",
        description:
          "Root output directory (default: tests/generated/scripts/<project>/<role>)",
      },
      {
        flag: "--overwrite-pom",
        description:
          "Re-generate POM .page.ts files even if they already exist (overwrites hand-edits)",
      },
      {
        flag: "--no-istqb",
        description: "Omit ISTQB TC-ID/technique annotation comments from test blocks",
      },
      {
        flag: "--timeout",
        description: "Per-scenario Playwright timeout in ms (default: 30000)",
      },
    ],
  },

  run: async (args) => {
    const manifestPath = flagString(args, "manifest");
    if (!manifestPath) {
      process.stderr.write("Missing --manifest\n");
      return 1;
    }

    const timeoutStr = flagString(args, "timeout");
    const scenarioTimeoutMs = timeoutStr ? parseInt(timeoutStr, 10) : undefined;

    let result;
    try {
      result = await generateAutomationScripts({
        manifestPath,
        outputDir: flagString(args, "output-dir"),
        overwritePom: flagBool(args, "overwrite-pom"),
        istqbAnnotations: !flagBool(args, "no-istqb"),
        scenarioTimeoutMs,
      });
    } catch (err) {
      process.stderr.write(`generate-scripts failed: ${(err as Error).message}\n`);
      return 2;
    }

    const { totals, scriptsDir, files, errors } = result;

    process.stdout.write(
      `\n✓ Generated ${totals.filesWritten} spec file(s) in ${scriptsDir}\n`,
    );
    process.stdout.write(
      `  POM files written:    ${totals.pomFilesWritten}\n`,
    );
    if (totals.pomFilesPreserved > 0) {
      process.stdout.write(
        `  POM files preserved:  ${totals.pomFilesPreserved} (use --overwrite-pom to regenerate)\n`,
      );
    }
    process.stdout.write(
      `  Scenarios:            ${totals.scenariosTotal - totals.scenariosSkipped} scripted` +
      (totals.scenariosSkipped > 0 ? `, ${totals.scenariosSkipped} skipped` : "") +
      "\n",
    );

    process.stdout.write("\n  Files:\n");
    for (const f of files) {
      process.stdout.write(`    spec → ${f.specPath}\n`);
      process.stdout.write(
        `    pom  → ${f.pomPath}${f.pomOverwritten ? " (overwritten)" : " (new)"}\n`,
      );
      process.stdout.write(`           ${f.scenarioCount} test(s)\n`);
    }

    if (errors.length > 0) {
      process.stderr.write(`\n  Errors (${errors.length} page(s) skipped):\n`);
      for (const e of errors) {
        process.stderr.write(`  ✗ ${e.pageUrl}: ${e.reason}\n`);
      }
      return totals.filesWritten ? 0 : 2;
    }

    process.stdout.write(`\nRun generated tests:\n`);
    process.stdout.write(`  npx playwright test --config ${scriptsDir}/playwright.config.ts\n\n`);
    return 0;
  },
};
