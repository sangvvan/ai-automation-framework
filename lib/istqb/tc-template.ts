/**
 * ISTQB Test Case Template Generator
 *
 * Produces human-friendly YAML and Markdown test case templates that follow
 * ISTQB-CTFL v4.0 structure (aligned with ISO/IEC 29119-3).
 *
 * Each generated template includes:
 *   - TC-ID, title, objective
 *   - Preconditions
 *   - ISTQB design technique tag
 *   - Numbered steps with action + expected result per step
 *   - Overall expected result
 *   - Postconditions
 *   - Priority / severity
 *   - References to requirements / acceptance criteria
 *   - Traceability fields
 *
 * Human testers fill in the template; the framework then parses the YAML
 * through the existing scenario pipeline and executes it automatically.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  ISTQB_TECHNIQUE_DESCRIPTIONS,
  PRIORITY_GUIDANCE,
  type IstqbTechnique,
  type IstqbTestLevel,
  type IstqbTestType,
} from "./standards";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TcTemplateOptions {
  /** Page or feature under test */
  pageUrl?: string;
  /** Hint for the technique to apply */
  technique?: IstqbTechnique;
  /** ISTQB test level */
  testLevel?: IstqbTestLevel;
  /** Functional vs non-functional */
  testType?: IstqbTestType;
  /** Optional requirement IDs to pre-fill in the template */
  requirementIds?: string[];
  /** Number of blank steps to scaffold */
  stepCount?: number;
  /** Output format */
  format?: "yaml" | "markdown" | "both";
  /** Directory to write template file(s) into */
  outputDir?: string;
  /** Project name (used in TC-ID prefix) */
  project?: string;
}

export interface TcTemplateResult {
  yamlPath?: string;
  markdownPath?: string;
  /** Preview of the YAML content */
  yamlContent?: string;
  /** Preview of the Markdown content */
  markdownContent?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate one or more ISTQB-compliant test case template files.
 * When outputDir is supplied the files are written to disk.
 * Always returns the generated content strings.
 */
export async function generateIstqbTemplate(
  opts: TcTemplateOptions = {},
): Promise<TcTemplateResult> {
  const {
    pageUrl = "https://example.com/page",
    technique = "equivalence-partition",
    testLevel = "system",
    testType = "functional",
    requirementIds = ["REQ-001"],
    stepCount = 5,
    format = "both",
    outputDir,
    project = "MY-PROJECT",
  } = opts;

  const tcId = `TC-${project.toUpperCase().replace(/[^A-Z0-9]/g, "-")}-001`;
  const timestamp = new Date().toISOString().slice(0, 10);

  const yamlContent = buildYamlTemplate({
    tcId,
    pageUrl,
    technique,
    testLevel,
    testType,
    requirementIds,
    stepCount,
    timestamp,
  });

  const markdownContent = buildMarkdownTemplate({
    tcId,
    pageUrl,
    technique,
    testLevel,
    testType,
    requirementIds,
    stepCount,
    timestamp,
    project,
  });

  const result: TcTemplateResult = {};

  if (format === "yaml" || format === "both") {
    result.yamlContent = yamlContent;
    if (outputDir) {
      await mkdir(outputDir, { recursive: true });
      const yamlPath = path.join(outputDir, `${tcId}.yaml`);
      await writeFile(yamlPath, yamlContent, "utf8");
      result.yamlPath = yamlPath;
    }
  }

  if (format === "markdown" || format === "both") {
    result.markdownContent = markdownContent;
    if (outputDir) {
      await mkdir(outputDir, { recursive: true });
      const mdPath = path.join(outputDir, `${tcId}.md`);
      await writeFile(mdPath, markdownContent, "utf8");
      result.markdownPath = mdPath;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// YAML template builder
// ---------------------------------------------------------------------------

interface TemplateContext {
  tcId: string;
  pageUrl: string;
  technique: IstqbTechnique;
  testLevel: IstqbTestLevel;
  testType: IstqbTestType;
  requirementIds: string[];
  stepCount: number;
  timestamp: string;
}

function buildYamlTemplate(ctx: TemplateContext): string {
  const techniqueDescription = ISTQB_TECHNIQUE_DESCRIPTIONS[ctx.technique];

  const steps = Array.from({ length: ctx.stepCount }, (_, i) => {
    const idx = i + 1;
    return [
      `  - index: ${i}`,
      `    description: "Step ${idx}: <describe the action — e.g. 'click Submit button'>"`,
      `    action:`,
      `      # Choose ONE action keyword: open_page | click | fill | select |`,
      `      # verify_text | verify_url | wait_for | upload_file | drag_drop |`,
      `      # type_keyboard | scroll_to | verify_screenshot`,
      `      keyword: click`,
      `      target:`,
      `        # Locator kinds: role | label | text | testId`,
      `        kind: role`,
      `        role: button`,
      `        name: "<button accessible name>"`,
      `    resolved: true`,
    ].join("\n");
  }).join("\n\n");

  return [
    `# ISTQB Test Case — ${ctx.tcId}`,
    `# Standard: ISTQB-CTFL v4.0 / ISO/IEC 29119-3`,
    `# Generated: ${ctx.timestamp}`,
    `# INSTRUCTIONS: Replace all <placeholder> values with real content.`,
    `#               Fields prefixed with # are comments — remove before parsing.`,
    ``,
    `# ── Metadata ────────────────────────────────────────────────────────────────`,
    `pageUrl: "${ctx.pageUrl}"`,
    ``,
    `scenarios:`,
    `  - id: "${ctx.tcId}"`,
    `    title: "<One-line test objective — e.g. 'Valid login with correct credentials'>"`,
    ``,
    `    # Scenario type: positive | negative | required-field | boundary |`,
    `    #                navigation | ui | error-handling | accessibility | security`,
    `    type: positive`,
    ``,
    `    # Priority: P1 (must-pass) | P2 (should-pass) | P3 (nice-to-have)`,
    `    # P1: ${PRIORITY_GUIDANCE["P1"]}`,
    `    # P2: ${PRIORITY_GUIDANCE["P2"]}`,
    `    # P3: ${PRIORITY_GUIDANCE["P3"]}`,
    `    priority: P2`,
    ``,
    `    # ISTQB design technique (CTFL Chapter 4):`,
    `    # ${ctx.technique}: ${techniqueDescription}`,
    `    designTechnique: ${ctx.technique}`,
    ``,
    `    # Traceability`,
    `    # requirements: list the requirement / AC / user story IDs this TC covers`,
    `    # requirements: [${ctx.requirementIds.join(", ")}]`,
    ``,
    `    # ── Preconditions ──────────────────────────────────────────────────────`,
    `    # List everything that must be true before execution begins.`,
    `    # Examples: user is logged in, data set X is loaded, feature flag Y is on`,
    `    # preconditions:`,
    `    #   - "User has a valid account with role: <role>"`,
    `    #   - "Browser: Chrome latest, viewport 1280×720"`,
    `    #   - "<additional precondition>"`,
    ``,
    `    # ── Test Steps ─────────────────────────────────────────────────────────`,
    `    steps:`,
    steps,
    ``,
    `    # ── Expected Result (overall) ──────────────────────────────────────────`,
    `    # At least ONE of url, text, or visibleLocator must be provided.`,
    `    expectedResult:`,
    `      # url: "https://example.com/success"          # page navigates to this URL`,
    `      # text: "Welcome back"                         # text visible on page`,
    `      # visibleLocator:                              # element is visible`,
    `      #   kind: role`,
    `      #   role: heading`,
    `      #   name: "Dashboard"`,
    `      url: "<expected URL after the final step>"`,
    ``,
    `    # ── Postconditions ─────────────────────────────────────────────────────`,
    `    # State of the system after the test (for cleanup or chained tests).`,
    `    # postconditions:`,
    `    #   - "User is on the dashboard page"`,
    `    #   - "Test data record created during this TC is removed"`,
    ``,
    `    origin: testcase-yaml`,
    ``,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Markdown template builder
// ---------------------------------------------------------------------------

interface MarkdownTemplateContext extends TemplateContext {
  project: string;
}

function buildMarkdownTemplate(ctx: MarkdownTemplateContext): string {
  const techniqueDesc = ISTQB_TECHNIQUE_DESCRIPTIONS[ctx.technique];

  const stepsTable = Array.from({ length: ctx.stepCount }, (_, i) => {
    const n = i + 1;
    return `| ${n} | <action description> | <expected result for this step> |`;
  }).join("\n");

  return [
    `# ${ctx.tcId} — <Test Case Title>`,
    ``,
    `> **Standard:** ISTQB-CTFL v4.0 / ISO/IEC 29119-3  `,
    `> **Project:** ${ctx.project}  `,
    `> **Created:** ${ctx.timestamp}  `,
    `> **Author:** <your name>`,
    ``,
    `---`,
    ``,
    `## 1. Objective`,
    ``,
    `> Describe in one sentence what this test case verifies.`,
    ``,
    `<What functionality / requirement is being validated?>`,
    ``,
    `---`,
    ``,
    `## 2. Scope`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| **Page / Feature** | ${ctx.pageUrl} |`,
    `| **Test Level** | ${ctx.testLevel} |`,
    `| **Test Type** | ${ctx.testType} |`,
    `| **Design Technique** | ${ctx.technique} |`,
    `| **Priority** | P2 |`,
    `| **Requirements** | ${ctx.requirementIds.join(", ")} |`,
    ``,
    `> **Technique explanation:** ${techniqueDesc}`,
    ``,
    `---`,
    ``,
    `## 3. Preconditions`,
    ``,
    `List everything that must be true *before* test execution begins:`,
    ``,
    `- [ ] <Precondition 1 — e.g. "User has an active account with role: tester">`,
    `- [ ] <Precondition 2 — e.g. "Browser: Chrome latest, viewport 1280×720">`,
    `- [ ] <Add more as needed>`,
    ``,
    `---`,
    ``,
    `## 4. Test Steps`,
    ``,
    `| Step | Action | Step-Level Expected Result |`,
    `|---|---|---|`,
    stepsTable,
    ``,
    `---`,
    ``,
    `## 5. Overall Expected Result`,
    ``,
    `> What must be true after the *last* step for the test to pass?`,
    ``,
    `<Describe the final observable outcome — page URL, visible element, message, etc.>`,
    ``,
    `---`,
    ``,
    `## 6. Postconditions`,
    ``,
    `State of the system after the test (needed for cleanup / chained tests):`,
    ``,
    `- <Postcondition 1 — e.g. "Test data record created during this TC is cleaned up">`,
    `- <Postcondition 2>`,
    ``,
    `---`,
    ``,
    `## 7. Test Data`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Username | test-user@example.com |`,
    `| Password | *(inject via env var SITE_PASSWORD)* |`,
    `| <Other field> | <value> |`,
    ``,
    `> Use synthetic placeholder data. Never commit real credentials.`,
    ``,
    `---`,
    ``,
    `## 8. Traceability`,
    ``,
    `| Artifact | ID / Link |`,
    `|---|---|`,
    `| Requirement | ${ctx.requirementIds.join(", ")} |`,
    `| User Story | <JIRA/Linear link> |`,
    `| Defect (if regression) | <Bug tracker ID> |`,
    `| Related TC | <other TC-IDs> |`,
    ``,
    `---`,
    ``,
    `## 9. Notes`,
    ``,
    `<Any additional context, known limitations, or reviewer notes.>`,
    ``,
    `---`,
    ``,
    `*This template follows ISTQB-CTFL v4.0 and ISO/IEC 29119-3.*  `,
    `*To execute automatically, copy the YAML variant to \`tests/generated/<project>/\` and run \`ai-test run-suite\`.*`,
    ``,
  ].join("\n");
}
