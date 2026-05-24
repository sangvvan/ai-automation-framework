/**
 * CLI command: istqb-template
 *
 * Generates ISTQB-CTFL v4.0 compliant test case template files (YAML and/or
 * Markdown) for human testers to fill in.
 *
 * The generated YAML template is executable by the framework — once a tester
 * fills in the placeholders, it can be run directly via `ai-test run-suite`.
 *
 * Usage:
 *   ai-test istqb-template --project my-app --technique boundary-value
 *   ai-test istqb-template --project my-app --output-dir docs/test-cases --format both
 */

import { flagString } from "../args";
import type { CliCommand } from "../commands";
import { generateIstqbTemplate } from "../../istqb/tc-template";
import { ISTQB_TECHNIQUE_DESCRIPTIONS } from "../../istqb/standards";
import type { IstqbTechnique, IstqbTestLevel, IstqbTestType } from "../../istqb/standards";

const VALID_TECHNIQUES = Object.keys(ISTQB_TECHNIQUE_DESCRIPTIONS) as IstqbTechnique[];
const VALID_LEVELS: IstqbTestLevel[] = [
  "unit",
  "component-integration",
  "system",
  "system-integration",
  "acceptance",
];
const VALID_TYPES: IstqbTestType[] = [
  "functional",
  "non-functional",
  "structural",
  "regression",
  "confirmation",
];

export const istqbTemplateCommand: CliCommand = {
  help: {
    name: "istqb-template",
    summary:
      "Generate an ISTQB-CTFL v4.0 compliant test case template (YAML + Markdown) for human testers.",
    example:
      "ai-test istqb-template --project my-app --technique boundary-value --output-dir docs/test-cases",
    options: [
      { flag: "--project", description: "Project name used in the TC-ID prefix (default: MY-PROJECT)" },
      { flag: "--page-url", description: "URL of the page under test" },
      {
        flag: "--technique",
        description: `ISTQB design technique: ${VALID_TECHNIQUES.join(" | ")}`,
        default: "equivalence-partition",
      },
      {
        flag: "--test-level",
        description: `ISTQB test level: ${VALID_LEVELS.join(" | ")}`,
        default: "system",
      },
      {
        flag: "--test-type",
        description: `ISTQB test type: ${VALID_TYPES.join(" | ")}`,
        default: "functional",
      },
      { flag: "--requirements", description: "Comma-separated requirement IDs (e.g. REQ-001,REQ-002)" },
      { flag: "--steps", description: "Number of blank steps to scaffold (default: 5)" },
      {
        flag: "--format",
        description: "Output format: yaml | markdown | both (default: both)",
        default: "both",
      },
      { flag: "--output-dir", description: "Directory to write template files into" },
    ],
  },

  run: async (args) => {
    const project = flagString(args, "project") ?? "MY-PROJECT";
    const pageUrl = flagString(args, "page-url");
    const techniqueRaw = flagString(args, "technique") ?? "equivalence-partition";
    const testLevelRaw = flagString(args, "test-level") ?? "system";
    const testTypeRaw = flagString(args, "test-type") ?? "functional";
    const requirementsRaw = flagString(args, "requirements");
    const stepsRaw = flagString(args, "steps");
    const formatRaw = flagString(args, "format") ?? "both";
    const outputDir = flagString(args, "output-dir");

    // Validate technique
    if (!VALID_TECHNIQUES.includes(techniqueRaw as IstqbTechnique)) {
      process.stderr.write(
        `Invalid --technique "${techniqueRaw}". Valid values: ${VALID_TECHNIQUES.join(", ")}\n`,
      );
      return 1;
    }

    // Validate level
    if (!VALID_LEVELS.includes(testLevelRaw as IstqbTestLevel)) {
      process.stderr.write(
        `Invalid --test-level "${testLevelRaw}". Valid values: ${VALID_LEVELS.join(", ")}\n`,
      );
      return 1;
    }

    // Validate type
    if (!VALID_TYPES.includes(testTypeRaw as IstqbTestType)) {
      process.stderr.write(
        `Invalid --test-type "${testTypeRaw}". Valid values: ${VALID_TYPES.join(", ")}\n`,
      );
      return 1;
    }

    // Validate format
    if (!["yaml", "markdown", "both"].includes(formatRaw)) {
      process.stderr.write(`Invalid --format "${formatRaw}". Use: yaml | markdown | both\n`);
      return 1;
    }

    const requirementIds = requirementsRaw
      ? requirementsRaw.split(",").map((r) => r.trim()).filter(Boolean)
      : ["REQ-001"];

    const stepCount = stepsRaw ? Math.max(1, parseInt(stepsRaw, 10)) : 5;

    let result;
    try {
      result = await generateIstqbTemplate({
        project,
        pageUrl,
        technique: techniqueRaw as IstqbTechnique,
        testLevel: testLevelRaw as IstqbTestLevel,
        testType: testTypeRaw as IstqbTestType,
        requirementIds,
        stepCount,
        format: formatRaw as "yaml" | "markdown" | "both",
        outputDir,
      });
    } catch (err) {
      process.stderr.write(`istqb-template failed: ${(err as Error).message}\n`);
      return 2;
    }

    // Print the technique guide
    const techniqueDesc = ISTQB_TECHNIQUE_DESCRIPTIONS[techniqueRaw as IstqbTechnique];
    process.stdout.write(`\n🔬 ISTQB Technique: ${techniqueRaw}\n`);
    process.stdout.write(`   ${techniqueDesc}\n\n`);

    if (result.yamlPath) {
      process.stdout.write(`✓ YAML template:     ${result.yamlPath}\n`);
    }
    if (result.markdownPath) {
      process.stdout.write(`✓ Markdown template: ${result.markdownPath}\n`);
    }

    if (!outputDir) {
      // Print inline if no output dir supplied
      if (result.yamlContent) {
        process.stdout.write("\n── YAML Template ──────────────────────────────────────────\n");
        process.stdout.write(result.yamlContent);
      }
    }

    process.stdout.write("\n📋 Next steps:\n");
    process.stdout.write("   1. Fill in all <placeholder> values in the template\n");
    process.stdout.write("   2. Remove comment lines starting with #\n");
    process.stdout.write("   3. Run: ai-test run-suite --cases-dir <dir-containing-yaml>\n");
    process.stdout.write("   4. Or:  ai-test generate-scripts --manifest <manifest.json>\n\n");

    return 0;
  },
};
