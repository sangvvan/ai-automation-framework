/**
 * Playwright Automation Script Code Generator — Page Object Model edition
 *
 * Architecture (strict POM, two-zone spec):
 *
 *   tests/generated/scripts/<project>/<role>/
 *     playwright.config.ts
 *     <page-slug>.spec.ts          ← two zones: AUTO (hash-merged) + CUSTOM (never touched)
 *     pom/
 *       <page-slug>.page.ts        ← POM class: locators + goto()
 *
 * Spec file zones:
 *   AUTO  — header, imports, test.describe() with generated test() blocks.
 *            Blocks carry content hashes; only changed blocks are rewritten.
 *   CUSTOM — everything after // ──── ai-test:custom-start ────
 *            Tester owns this zone; tool never modifies it.
 *
 * POM rules (strict):
 *   • Spec files NEVER call page.getBy*() or page.goto() directly.
 *   • Every locator is a readonly field in the POM class.
 *   • Specs only contain test() blocks and expect() assertions.
 *   • POM class is always generated (not optional).
 */

import type {
  ExecutableScenario,
  Action,
  Locator,
  ExpectedResult,
} from "../validation";
import { scenarioHash, type SpecParts } from "./spec-merger";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PlaywrightCodegenOptions {
  /** Human-readable page title used in describe() + POM class name */
  pageTitle?: string;
  /**
   * Slug name for the POM file (e.g. "auth-login-edbfc1dd").
   * When set, the spec imports from ./pom/<pomSlugName>.page instead of
   * deriving the name from the page URL. Must match the actual .page.ts filename.
   */
  pomSlugName?: string;
  /** ISTQB technique comments above each test (default true) */
  istqbAnnotations?: boolean;
  /** Per-scenario Playwright timeout in ms (default 30000) */
  scenarioTimeoutMs?: number;
}

export interface GeneratedScript {
  /**
   * Structured spec parts ready for the smart merger.
   * Pass this to mergeAndWriteSpec() — do NOT write testCode directly.
   */
  specParts: SpecParts;
  /** .page.ts content — POM class with locators + goto() */
  pomCode: string;
  /** Relative import path the spec uses for the POM (no .ts extension) */
  pomImportPath: string;
  /** Scenarios that could not be scripted */
  skippedScenarios: { id: string; reason: string }[];
}

/**
 * Generate structured spec parts + POM class for a group of scenarios that
 * share the same page URL.
 *
 * Callers must pass specParts to mergeAndWriteSpec() to get the final file
 * content — this function does not perform any I/O.
 */
export function generatePlaywrightScript(
  scenarios: ExecutableScenario[],
  opts: PlaywrightCodegenOptions = {},
): GeneratedScript {
  if (scenarios.length === 0) {
    const emptyParts: SpecParts = {
      header: "// No scenarios to generate.\n",
      describeOpen: "test.describe('(empty)', () => {",
      testBlocks: new Map(),
      indentSpaces: 2,
    };
    return {
      specParts: emptyParts,
      pomCode: "// No scenarios — POM class empty.\n",
      pomImportPath: "./pom/page",
      skippedScenarios: [],
    };
  }

  const {
    pageTitle,
    pomSlugName,
    istqbAnnotations = true,
    scenarioTimeoutMs = 30_000,
  } = opts;

  const pageUrl = scenarios[0].pageUrl;
  const describeLabel = pageTitle ?? derivePageTitle(pageUrl);
  const className = toClassName(describeLabel) + "Page";
  // Use pomSlugName when provided so the import path matches the actual file on disk.
  const pomRelPath = pomSlugName
    ? `./pom/${pomSlugName}.page`
    : `./pom/${toFileName(describeLabel)}.page`;

  // ── 1. Collect every unique locator across all scenarios ─────────────────
  const locatorRegistry = buildLocatorRegistry(scenarios);

  // ── 2. Build POM class ────────────────────────────────────────────────────
  const pomCode = buildPomClass({ className, pageUrl, pageTitle: describeLabel, locatorRegistry });

  // ── 3. Build individual test blocks (no sentinels yet — merger adds them) ─
  const skippedScenarios: { id: string; reason: string }[] = [];
  const testBlocks = new Map<string, { hash: string; code: string }>();

  for (const scenario of scenarios) {
    const block = buildTestBlock(scenario, {
      className,
      locatorRegistry,
      istqbAnnotations,
      scenarioTimeoutMs,
    });
    if (block.skipped) {
      skippedScenarios.push({ id: scenario.id, reason: block.skipped });
    } else {
      testBlocks.set(scenario.id, {
        hash: scenarioHash(scenario),
        code: block.code,
      });
    }
  }

  // ── 4. Build spec header (comment + imports) ──────────────────────────────
  const header = [
    `/**`,
    ` * Auto-generated Playwright tests — Page Object Model`,
    ` * Page:  ${describeLabel}`,
    ` * URL:   ${pageUrl}`,
    ` * POM:   ${pomRelPath}.ts`,
    ` *`,
    ` * AUTO zone: managed by ai-test — individual test() blocks are`,
    ` * updated only when their scenario changes (hash-based merge).`,
    ` * CUSTOM zone (below ──── ai-test:custom-start ────): yours to edit,`,
    ` * never touched by ai-test.`,
    ` */`,
    `import { test, expect } from '@playwright/test';`,
    `import { ${className} } from '${pomRelPath}';`,
  ].join("\n");

  const specParts: SpecParts = {
    header,
    describeOpen: `test.describe('${escStr(describeLabel)}', () => {`,
    testBlocks,
    indentSpaces: 2,
  };

  return { specParts, pomCode, pomImportPath: pomRelPath, skippedScenarios };
}

// ---------------------------------------------------------------------------
// Locator registry
// ---------------------------------------------------------------------------

interface LocatorEntry {
  fieldName: string;
  playwrightExpr: string;
  locator: Locator;
}

type LocatorRegistry = Map<string, LocatorEntry>;

function buildLocatorRegistry(scenarios: ExecutableScenario[]): LocatorRegistry {
  const registry: LocatorRegistry = new Map();
  const usedNames = new Set<string>();

  for (const scenario of scenarios) {
    for (const step of scenario.steps) {
      for (const loc of extractLocatorsFromAction(step.action)) {
        const key = locatorKey(loc);
        if (registry.has(key)) continue;
        let name = locatorToCamelName(loc);
        if (usedNames.has(name)) {
          let i = 2;
          while (usedNames.has(`${name}${i}`)) i++;
          name = `${name}${i}`;
        }
        usedNames.add(name);
        registry.set(key, {
          fieldName: name,
          playwrightExpr: locatorToPlaywrightExpr(loc, "this.page"),
          locator: loc,
        });
      }
    }
  }
  return registry;
}

function extractLocatorsFromAction(action: Action): Locator[] {
  const locs: Locator[] = [];
  if ("target" in action && action.target) locs.push(action.target);
  if ("source" in action) locs.push((action as { source: Locator }).source);
  return locs.filter(Boolean);
}

function locatorKey(loc: Locator): string {
  switch (loc.kind) {
    case "role":   return `role::${loc.role}::${loc.name ?? ""}`;
    case "label":  return `label::${loc.text}`;
    case "text":   return `text::${loc.text}`;
    case "testId": return `testId::${loc.value}`;
    case "css":    return `css::${loc.selector}`;
    case "xpath":  return `xpath::${loc.selector}`;
    default:       return JSON.stringify(loc);
  }
}

function locatorToCamelName(loc: Locator): string {
  switch (loc.kind) {
    case "role":   return toCamel(`${loc.name ?? loc.role} ${loc.role}`);
    case "label":  return toCamel(loc.text);
    case "text":   return toCamel(loc.text);
    case "testId": return toCamel(loc.value);
    case "css":    return toCamel(loc.selector.replace(/[^\w]/g, " "));
    case "xpath":  return toCamel(loc.selector.replace(/[^\w]/g, " "));
    default:       return "element";
  }
}

// ---------------------------------------------------------------------------
// POM class builder
// ---------------------------------------------------------------------------

function buildPomClass(opts: {
  className: string;
  pageUrl: string;
  pageTitle: string;
  locatorRegistry: LocatorRegistry;
}): string {
  const { className, pageUrl, pageTitle, locatorRegistry } = opts;

  const fields = [...locatorRegistry.values()]
    .map((e) => `  readonly ${e.fieldName}: Locator;`)
    .join("\n");

  const assignments = [...locatorRegistry.values()]
    .map((e) => `    this.${e.fieldName} = ${e.playwrightExpr};`)
    .join("\n");

  const hasLocators = locatorRegistry.size > 0;

  return [
    `/**`,
    ` * Page Object Model — ${pageTitle}`,
    ` * URL: ${pageUrl}`,
    ` *`,
    ` * Auto-generated. You may add custom helper methods — they will not be`,
    ` * overwritten on re-generation unless --overwrite-pom is passed.`,
    ` */`,
    `import { type Page, type Locator } from '@playwright/test';`,
    ``,
    `export class ${className} {`,
    `  readonly page: Page;`,
    ``,
    hasLocators
      ? `  // ── Locators ──────────────────────────────────────────────────────────────`
      : `  // (no locators derived from scenarios)`,
    hasLocators ? fields : "",
    ``,
    `  constructor(page: Page) {`,
    `    this.page = page;`,
    hasLocators ? assignments : "",
    `  }`,
    ``,
    `  // ── Navigation ───────────────────────────────────────────────────────────────`,
    `  async goto() {`,
    `    await this.page.goto('${escStr(pageUrl)}');`,
    `  }`,
    ``,
    `  // ── Add helper methods below (safe to edit) ──────────────────────────────────`,
    `  // async login(email: string, password: string) {`,
    `  //   await this.emailInput.fill(email);`,
    `  //   await this.passwordInput.fill(password);`,
    `  //   await this.submitButton.click();`,
    `  // }`,
    `}`,
    ``,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Test block builder  (no sentinel — merger adds sentinels around this)
// ---------------------------------------------------------------------------

const POM_VAR = "pg";

interface TestBlockResult {
  code: string;
  skipped?: string;
}

function buildTestBlock(
  scenario: ExecutableScenario,
  opts: {
    className: string;
    locatorRegistry: LocatorRegistry;
    istqbAnnotations: boolean;
    scenarioTimeoutMs: number;
  },
): TestBlockResult {
  const { className, locatorRegistry, istqbAnnotations, scenarioTimeoutMs } = opts;
  const pad = "  "; // 2-space inside describe, test body gets another 2
  const lines: string[] = [];

  if (istqbAnnotations) {
    lines.push(
      `${pad}// ISTQB TC-ID: ${scenario.id}  ` +
      `Type: ${scenario.type}  Priority: ${scenario.priority}` +
      (scenario.designTechnique ? `  Technique: ${scenario.designTechnique}` : ""),
    );
  }

  lines.push(`${pad}test('${escStr(scenario.title)}', async ({ page }) => {`);
  lines.push(`${pad}  test.setTimeout(${scenarioTimeoutMs});`);
  lines.push(`${pad}  const ${POM_VAR} = new ${className}(page);`);
  lines.push("");

  let firstNavStep = true;
  for (const step of scenario.steps) {
    const isGoto =
      step.action.keyword === "open_page" &&
      firstNavStep &&
      step.action.url === scenario.pageUrl;

    lines.push(`${pad}  // Step ${step.index + 1}: ${step.description}`);
    const stepCode = isGoto
      ? `${pad}  await ${POM_VAR}.goto();`
      : actionToSpec(step.action, locatorRegistry, pad + "  ");

    lines.push(stepCode ?? `${pad}  // TODO: unsupported action "${(step.action as { keyword: string }).keyword}"`);
    lines.push("");

    if (step.action.keyword !== "wait_for") firstNavStep = false;
  }

  const assertions = expectedResultToAssertions(scenario.expectedResult, locatorRegistry, pad + "  ");
  if (assertions.length > 0) {
    lines.push(`${pad}  // ── Expected result ─────────────────────────────────────────────────────`);
    lines.push(...assertions);
    lines.push("");
  }

  lines.push(`${pad}});`);
  return { code: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// Action → spec line  (uses POM field names, never raw page.getBy*())
// ---------------------------------------------------------------------------

function actionToSpec(
  action: Action,
  registry: LocatorRegistry,
  pad: string,
): string | null {
  switch (action.keyword) {
    case "open_page":
      return `${pad}await page.goto('${escStr(action.url)}');`;

    case "click":
      return `${pad}await ${POM_VAR}.${field(action.target, registry)}.click();`;

    case "fill":
      return `${pad}await ${POM_VAR}.${field(action.target, registry)}.fill('${escStr(action.value)}');`;

    case "select":
      return `${pad}await ${POM_VAR}.${field(action.target, registry)}.selectOption('${escStr(action.value)}');`;

    case "verify_text":
      if (action.target) {
        return `${pad}await expect(${POM_VAR}.${field(action.target, registry)}).toContainText('${escStr(action.text)}');`;
      }
      return `${pad}await expect(page.getByText('${escStr(action.text)}')).toBeVisible();`;

    case "verify_url":
      // Use string matching (toHaveURL accepts partial strings) to avoid
      // broken JS regex literals when the pattern contains forward slashes.
      return `${pad}await expect(page).toHaveURL('${escStr(action.pattern)}');`;

    case "wait_for": {
      if (action.strategy === "network-idle") return `${pad}await page.waitForLoadState('networkidle');`;
      if (action.strategy === "route-change")  return `${pad}await page.waitForURL(/./);`;
      if (action.target) return `${pad}await ${POM_VAR}.${field(action.target, registry)}.waitFor({ state: 'visible' });`;
      return `${pad}await page.waitForLoadState('domcontentloaded');`;
    }

    case "upload_file":
      return `${pad}await ${POM_VAR}.${field(action.target, registry)}.setInputFiles('${escStr(action.filePath)}');`;

    case "drag_drop":
      return `${pad}await ${POM_VAR}.${field(action.source, registry)}.dragTo(${POM_VAR}.${field(action.target, registry)});`;

    case "type_keyboard":
      return `${pad}await page.keyboard.press('${escStr(action.keys)}');`;

    case "scroll_to":
      return `${pad}await ${POM_VAR}.${field(action.target, registry)}.scrollIntoViewIfNeeded();`;

    case "verify_screenshot":
      return `${pad}await expect(page).toHaveScreenshot('${escStr(action.name)}.png'${
        action.threshold !== undefined ? `, { maxDiffRatio: ${action.threshold} }` : ""
      });`;

    default:
      return null;
  }
}

function field(loc: Locator, registry: LocatorRegistry): string {
  return registry.get(locatorKey(loc))?.fieldName ?? `page.${locatorToPlaywrightExpr(loc, "page")}`;
}

// ---------------------------------------------------------------------------
// ExpectedResult → assertion lines
// ---------------------------------------------------------------------------

function expectedResultToAssertions(
  expected: ExpectedResult,
  registry: LocatorRegistry,
  pad: string,
): string[] {
  const lines: string[] = [];
  const locExpr = (loc: Locator) => {
    const f = registry.get(locatorKey(loc));
    return f ? `${POM_VAR}.${f.fieldName}` : locatorToPlaywrightExpr(loc, "page");
  };

  if (expected.url)          lines.push(`${pad}await expect(page).toHaveURL('${escStr(expected.url)}');`);
  if (expected.text)         lines.push(`${pad}await expect(page.getByText('${escStr(expected.text)}')).toBeVisible();`);
  if (expected.visibleLocator) lines.push(`${pad}await expect(${locExpr(expected.visibleLocator)}).toBeVisible();`);
  for (const vl of expected.visibleLocators ?? [])    lines.push(`${pad}await expect(${locExpr(vl)}).toBeVisible();`);
  for (const nvl of expected.notVisibleLocators ?? []) lines.push(`${pad}await expect(${locExpr(nvl)}).not.toBeVisible();`);
  if (expected.urlNotContains) lines.push(`${pad}await expect(page).not.toHaveURL(/${escRegex(expected.urlNotContains).replace(/\//g, "\\/")}/);`);
  if (expected.textNotContains) lines.push(`${pad}await expect(page.getByText('${escStr(expected.textNotContains)}')).not.toBeVisible();`);
  if (expected.attribute) {
    const expr = locExpr(expected.attribute.target);
    if (expected.attribute.equals !== undefined)
      lines.push(`${pad}await expect(${expr}).toHaveAttribute('${escStr(expected.attribute.name)}', '${escStr(expected.attribute.equals)}');`);
    else if (expected.attribute.contains !== undefined)
      lines.push(`${pad}await expect(${expr}).toHaveAttribute('${escStr(expected.attribute.name)}', /${escRegex(expected.attribute.contains)}/);`);
  }
  if (expected.childCount?.min !== undefined)
    lines.push(`${pad}await expect(${locExpr(expected.childCount.target)}.locator('*')).toHaveCount(${expected.childCount.min});`);

  return lines;
}

// ---------------------------------------------------------------------------
// Playwright locator expression  (used ONLY inside POM constructor)
// ---------------------------------------------------------------------------

function locatorToPlaywrightExpr(loc: Locator, ctx: string): string {
  switch (loc.kind) {
    case "role":
      return loc.name
        ? `${ctx}.getByRole('${loc.role}', { name: '${escStr(loc.name)}' })`
        : `${ctx}.getByRole('${loc.role}')`;
    case "label":  return `${ctx}.getByLabel('${escStr(loc.text)}')`;
    case "text":   return `${ctx}.getByText('${escStr(loc.text)}')`;
    case "testId": return `${ctx}.getByTestId('${escStr(loc.value)}')`;
    case "css":    return `${ctx}.locator('${escStr(loc.selector)}')`;
    case "xpath":  return `${ctx}.locator('xpath=${escStr(loc.selector)}')`;
    default:       return `${ctx}.locator('[data-unknown]')`;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function derivePageTitle(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/$/, "") || "/";
    return p === "/" ? u.hostname : `${u.hostname}${p}`;
  } catch { return url; }
}

function toClassName(label: string): string {
  return label
    .replace(/[^a-zA-Z0-9]+(.)/g, (_: string, c: string) => c.toUpperCase())
    .replace(/^(.)/, (c: string) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, "");
}

function toFileName(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function toCamel(str: string): string {
  const words = str.trim().replace(/[^a-zA-Z0-9\s]+/g, " ").split(/\s+/).filter(Boolean);
  return words.map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
}

function escStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
