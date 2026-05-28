/**
 * CLI command: generate-scripts
 *
 * Converts a test-case manifest (produced by `ai-test generate`) into
 * executable automation scripts.
 *
 * Python output (default):
 *   <output-dir>/
 *     conftest.py / pytest.ini / requirements.txt
 *     pages/base_page.py
 *     pages/<slug>_page.py    ← Page Object class
 *     tests/test_<slug>.py    ← pytest test class (AUTO + CUSTOM zones)
 *
 * TypeScript output (--language=typescript):
 *   <output-dir>/
 *     playwright.config.ts
 *     <page>.spec.ts          ← spec, imports POM class only
 *     pom/<page>.page.ts      ← POM class: locators + goto()
 *
 * Usage:
 *   ai-test generate-scripts --manifest tests/generated/my-app/admin/manifest.json
 *   ai-test generate-scripts --manifest ... --language=typescript
 *   ai-test generate-scripts --manifest ... --output-dir tests/e2e
 *   ai-test generate-scripts --manifest ... --overwrite-pom
 */

import { flagBool, flagString } from "../args";
import type { CliCommand } from "../commands";
import { generateAutomationScripts } from "../../codegen/script-writer";
import { generatePythonAutomationScripts } from "../../codegen/python-script-writer";

export const generateScriptsCommand: CliCommand = {
  help: {
    name: "generate-scripts",
    summary:
      "Convert YAML test-case files into Python pytest + POM or TypeScript Playwright automation scripts.",
    example:
      "ai-test generate-scripts --manifest tests/generated/my-app/admin/manifest.json\n" +
      "  ai-test generate-scripts --manifest ... --language=typescript",
    options: [
      {
        flag: "--manifest",
        description:
          "Path to the manifest.json produced by `ai-test generate` (required)",
      },
      {
        flag: "--language",
        description:
          "Output language: python (default) | typescript",
      },
      {
        flag: "--output-dir",
        description:
          "Root output directory (default: tests/generated/scripts/<project>/<role>)",
      },
      {
        flag: "--overwrite-pom",
        description:
          "Re-generate page-object files even if they already exist (overwrites hand-edits)",
      },
      {
        flag: "--no-istqb",
        description: "Omit ISTQB TC-ID/technique annotations from test blocks/docstrings",
      },
      {
        flag: "--timeout",
        description: "Per-scenario Playwright timeout in ms, TypeScript only (default: 30000)",
      },
    ],
  },

  run: async (args) => {
    const manifestPath = flagString(args, "manifest");
    if (!manifestPath) {
      process.stderr.write("Missing --manifest\n");
      return 1;
    }

    const language = (flagString(args, "language") ?? "python") as "python" | "typescript";
    const outputDir = flagString(args, "output-dir");
    const overwritePom = flagBool(args, "overwrite-pom");
    const istqbAnnotations = !flagBool(args, "no-istqb");

    if (language === "python") {
      let result;
      try {
        result = await generatePythonAutomationScripts({
          manifestPath,
          outputDir,
          overwritePom,
          istqbAnnotations,
        });
      } catch (err) {
        process.stderr.write(`generate-scripts (python) failed: ${(err as Error).message}\n`);
        return 2;
      }

      const { totals, scriptsDir, files, errors } = result;

      process.stdout.write(
        `\n✓ Generated ${totals.filesWritten} Python test file(s) in ${scriptsDir}\n`,
      );
      process.stdout.write(
        `  Page objects written:  ${totals.pageFilesWritten}\n`,
      );
      if (totals.pageFilesPreserved > 0) {
        process.stdout.write(
          `  Page objects preserved: ${totals.pageFilesPreserved} (use --overwrite-pom to regenerate)\n`,
        );
      }
      process.stdout.write(
        `  Scenarios:             ${totals.scenariosTotal - totals.scenariosSkipped} scripted` +
        (totals.scenariosSkipped > 0 ? `, ${totals.scenariosSkipped} skipped` : "") +
        "\n",
      );

      process.stdout.write("\n  Files:\n");
      for (const f of files) {
        process.stdout.write(`    test → ${f.testPath}  (${f.scenarioCount} test method(s))\n`);
        process.stdout.write(`    page → ${f.pagePath}${f.pageOverwritten ? " (overwritten)" : " (new)"}\n`);
      }

      if (errors.length > 0) {
        process.stderr.write(`\n  Errors (${errors.length} page(s) skipped):\n`);
        for (const e of errors) {
          process.stderr.write(`  ✗ ${e.pageUrl}: ${e.reason}\n`);
        }
        return totals.filesWritten ? 0 : 2;
      }

      process.stdout.write(`\nRun generated tests:\n`);
      process.stdout.write(`  cd ${scriptsDir} && pytest\n`);
      process.stdout.write(`  # or\n`);
      process.stdout.write(`  pytest --headed  # show browser\n\n`);
      return 0;
    }

    // TypeScript
    const timeoutStr = flagString(args, "timeout");
    const scenarioTimeoutMs = timeoutStr ? parseInt(timeoutStr, 10) : undefined;

    let result;
    try {
      result = await generateAutomationScripts({
        manifestPath,
        outputDir,
        overwritePom,
        istqbAnnotations,
        scenarioTimeoutMs,
      });
    } catch (err) {
      process.stderr.write(`generate-scripts (typescript) failed: ${(err as Error).message}\n`);
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
