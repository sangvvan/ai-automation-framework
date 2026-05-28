/**
 * Python + Playwright Automation Script Code Generator — Page Object Model edition
 *
 * Generates two files per page:
 *
 *   pages/<slug>_page.py   ← Page Object class (locators + goto + helper stubs)
 *   tests/test_<slug>.py   ← pytest test class (one method per scenario)
 *
 * Design principles applied:
 *   • Strict POM: test files never call page.get_by_*() directly — only POM properties
 *   • Class-based tests (class TestFoo:) for ISTQB grouping and easy sub-classing
 *   • Type hints throughout (PEP 484 / py.typed)
 *   • ISTQB technique, ID, type and priority as docstrings
 *   • One pytest fixture per test method (page: Page) — stateless isolation
 *   • Auto zone / Custom zone boundary preserved for re-generation (# @ai-block markers)
 */

import type {
  ExecutableScenario,
  Action,
  Locator,
  ExpectedResult,
} from "../validation";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PythonCodegenOptions {
  /** Override page label used in class name and docstring */
  pageTitle?: string;
  /** Slug used for the page filename (e.g. "auth-login-edbfc1dd") */
  pageSlugName?: string;
  /** Add ISTQB annotations as method docstrings (default true) */
  istqbAnnotations?: boolean;
}

export interface GeneratedPythonScript {
  /** Content of the Page Object .py file */
  pageCode: string;
  /** Content of the test .py file */
  testCode: string;
  /** Pascal-case class name, e.g. "AuthLoginPage" */
  pageClassName: string;
  /** snake_case module name for import, e.g. "auth_login_page" */
  pageModuleName: string;
  /** snake_case test module name, e.g. "test_auth_login" */
  testModuleName: string;
  /** Scenarios that could not be scripted */
  skippedScenarios: { id: string; reason: string }[];
}

/**
 * Generate Python Playwright POM page object + pytest test class
 * from a list of ExecutableScenario objects sharing the same page URL.
 */
export function generatePythonScript(
  scenarios: ExecutableScenario[],
  opts: PythonCodegenOptions = {},
): GeneratedPythonScript {
  const {
    pageTitle,
    pageSlugName,
    istqbAnnotations = true,
  } = opts;

  const pageUrl = scenarios[0]?.pageUrl ?? "";
  const label = pageTitle ?? derivePageTitle(pageUrl);
  const pageClassName = toPascalCase(label) + "Page";
  const pageModuleName = pageSlugName
    ? toSnake(pageSlugName)
    : toSnake(label) + "_page";
  const testModuleName = "test_" + (pageSlugName ? toSnake(pageSlugName) : toSnake(label));

  // ── 1. Collect every unique locator across all scenarios ─────────────────
  const locatorRegistry = buildLocatorRegistry(scenarios);

  // ── 2. Build Page Object class ────────────────────────────────────────────
  const pageCode = buildPageClass({ pageClassName, pageUrl, label, locatorRegistry });

  // ── 3. Build test class methods ───────────────────────────────────────────
  const skippedScenarios: { id: string; reason: string }[] = [];
  const testMethods: string[] = [];

  for (const scenario of scenarios) {
    const result = buildTestMethod(scenario, {
      pageClassName,
      pageModuleName,
      locatorRegistry,
      istqbAnnotations,
    });
    if (result.skipped) {
      skippedScenarios.push({ id: scenario.id, reason: result.skipped });
    } else {
      testMethods.push(result.code);
    }
  }

  // ── 4. Build test file ────────────────────────────────────────────────────
  const testCode = buildTestFile({
    label,
    pageUrl,
    pageClassName,
    pageModuleName,
    testMethods,
  });

  return {
    pageCode,
    testCode,
    pageClassName,
    pageModuleName,
    testModuleName,
    skippedScenarios,
  };
}

// ---------------------------------------------------------------------------
// Locator registry (shared between page object + test methods)
// ---------------------------------------------------------------------------

interface LocatorEntry {
  fieldName: string;   // snake_case attribute name in the page class
  pyExpr: string;      // Playwright Python expression (page.get_by_role(...))
  locator: Locator;
}

type LocatorRegistry = Map<string, LocatorEntry>;

function buildLocatorRegistry(scenarios: ExecutableScenario[]): LocatorRegistry {
  const registry: LocatorRegistry = new Map();
  const usedNames = new Set<string>();

  for (const scenario of scenarios) {
    for (const step of scenario.steps) {
      for (const loc of extractLocators(step.action)) {
        const key = locatorKey(loc);
        if (registry.has(key)) continue;
        let name = locatorToSnakeName(loc);
        if (usedNames.has(name)) {
          let i = 2;
          while (usedNames.has(`${name}_${i}`)) i++;
          name = `${name}_${i}`;
        }
        usedNames.add(name);
        registry.set(key, {
          fieldName: name,
          pyExpr: locatorToPyExpr(loc, "page"),
          locator: loc,
        });
      }
    }
  }
  return registry;
}

function extractLocators(action: Action): Locator[] {
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
    default:       return JSON.stringify(loc);
  }
}

function locatorToSnakeName(loc: Locator): string {
  switch (loc.kind) {
    case "role":   return toSnake(`${loc.name ?? loc.role}_${loc.role}`);
    case "label":  return toSnake(loc.text);
    case "text":   return toSnake(loc.text);
    case "testId": return toSnake(loc.value);
    default:       return "element";
  }
}

// ---------------------------------------------------------------------------
// Page Object class builder
// ---------------------------------------------------------------------------

function buildPageClass(opts: {
  pageClassName: string;
  pageUrl: string;
  label: string;
  locatorRegistry: LocatorRegistry;
}): string {
  const { pageClassName, pageUrl, label, locatorRegistry } = opts;

  const hasLocators = locatorRegistry.size > 0;
  const locatorLines = hasLocators
    ? [...locatorRegistry.values()]
        .map((e) => `        self.${e.fieldName}: Locator = ${e.pyExpr.replace(/^page\./, "page.")}`)
        .join("\n")
    : "";

  const hintLines = hasLocators
    ? [...locatorRegistry.values()]
        .map((e) => `    ${e.fieldName}: Locator`)
        .join("\n")
    : "    # (no locators derived from scenarios)";

  const lines: string[] = [
    `"""`,
    `Page Object Model — ${label}`,
    `URL: ${pageUrl}`,
    ``,
    `Auto-generated by ai-automation-framework.`,
    `Add custom helper methods below the "Custom helpers" section — they are`,
    `never overwritten unless --overwrite-pom is passed.`,
    `"""`,
    `from __future__ import annotations`,
    ``,
    `from playwright.sync_api import Locator, Page`,
    ``,
    `from .base_page import BasePage`,
    ``,
    ``,
    `class ${pageClassName}(BasePage):`,
    `    """Page Object — ${label}`,
    ``,
    `    Attributes:`,
    hintLines,
    `    """`,
    ``,
    `    URL = "${escPy(pageUrl)}"`,
    ``,
    `    def __init__(self, page: Page) -> None:`,
    `        super().__init__(page)`,
  ];

  if (hasLocators) {
    lines.push(`        # Locators — mapped from AI-resolved page elements`);
    lines.push(locatorLines);
  }

  lines.push(
    ``,
    `    def goto(self) -> None:  # type: ignore[override]`,
    `        self.page.goto(self.URL)`,
    ``,
    `    # ── Custom helpers (safe to edit — never overwritten) ────────────────────`,
    `    # def login(self, email: str, password: str) -> None:`,
    `    #     self.email_input.fill(email)`,
    `    #     self.password_input.fill(password)`,
    `    #     self.sign_in_button.click()`,
  );

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Test file builder
// ---------------------------------------------------------------------------

function buildTestFile(opts: {
  label: string;
  pageUrl: string;
  pageClassName: string;
  pageModuleName: string;
  testMethods: string[];
}): string {
  const { label, pageUrl, pageClassName, pageModuleName, testMethods } = opts;

  const lines = [
    `"""`,
    `Auto-generated Playwright tests — Page Object Model`,
    `Page:  ${label}`,
    `URL:   ${pageUrl}`,
    `POM:   pages/${pageModuleName}.py`,
    ``,
    `AUTO zone: managed by ai-automation-framework.`,
    `Individual test methods are updated only when their scenario changes.`,
    `CUSTOM zone (below # ──── ai-test:custom-start ────): yours to edit,`,
    `never touched by ai-automation-framework.`,
    `"""`,
    `from __future__ import annotations`,
    ``,
    `import pytest`,
    `from playwright.sync_api import Page, expect`,
    ``,
    `from pages.${pageModuleName} import ${pageClassName}`,
    ``,
    ``,
    `# ──── ai-test:auto-start ────`,
    ``,
    ``,
    `class Test${pageClassName} :`,
    `    """ISTQB system test suite — ${label}"""`,
    ``,
    ...testMethods,
    ``,
    `# ──── ai-test:auto-end ────`,
    ``,
    ``,
    `# ──── ai-test:custom-start ────`,
    `# Add your own test methods or additional test classes below.`,
    `# This section is NEVER overwritten by ai-automation-framework.`,
    `#`,
    `# Example:`,
    `# class Test${pageClassName}Custom:`,
    `#     def test_my_manual_case(self, page: Page) -> None:`,
    `#         pg = ${pageClassName}(page)`,
    `#         pg.goto()`,
    `#         # ... your steps here`,
  ];

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Test method builder
// ---------------------------------------------------------------------------

const POM_VAR = "pg";

interface MethodResult {
  code: string;
  skipped?: string;
}

function buildTestMethod(
  scenario: ExecutableScenario,
  opts: {
    pageClassName: string;
    pageModuleName: string;
    locatorRegistry: LocatorRegistry;
    istqbAnnotations: boolean;
  },
): MethodResult {
  const { pageClassName, locatorRegistry, istqbAnnotations } = opts;
  const pad = "    ";  // 4 spaces (inside class)
  const inner = "        ";  // 8 spaces (inside method)
  const lines: string[] = [];

  // @ai-block marker for smart re-generation
  lines.push(`${pad}# @ai-block:start id=${scenario.id} hash=${shortHash(scenario)}`);

  // Method name: test_<id_snake>_<title_snake>
  const methodName = `test_${toSnake(scenario.id)}_${toSnake(scenario.title).slice(0, 60)}`;

  lines.push(`${pad}def ${methodName}(self, page: Page) -> None:`);

  if (istqbAnnotations) {
    const docParts = [
      `${scenario.id} | ${scenario.type} | ${scenario.priority}`,
      scenario.designTechnique ? `| ${scenario.designTechnique}` : "",
      `\n${inner}${scenario.title}`,
    ].filter(Boolean).join(" ");
    lines.push(`${inner}"""${docParts}"""`);
  }

  lines.push(`${inner}${POM_VAR} = ${pageClassName}(page)`);
  lines.push("");

  let firstNavStep = true;
  for (const step of scenario.steps) {
    const isGoto =
      step.action.keyword === "open_page" &&
      firstNavStep &&
      step.action.url === scenario.pageUrl;

    lines.push(`${inner}# Step ${step.index + 1}: ${step.description}`);
    const stepCode = isGoto
      ? `${inner}${POM_VAR}.goto()`
      : actionToPy(step.action, locatorRegistry, inner);

    lines.push(stepCode ?? `${inner}# TODO: unsupported action "${(step.action as { keyword: string }).keyword}"`);
    lines.push("");

    if (step.action.keyword !== "wait_for") firstNavStep = false;
  }

  const assertions = expectedResultToPy(scenario.expectedResult, locatorRegistry, inner);
  if (assertions.length > 0) {
    lines.push(`${inner}# ── Expected result ─────────────────────────────────────────────────────`);
    lines.push(...assertions);
    lines.push("");
  }

  lines.push(`${pad}# @ai-block:end id=${scenario.id}`);

  return { code: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// Action → Python spec line
// ---------------------------------------------------------------------------

function actionToPy(
  action: Action,
  registry: LocatorRegistry,
  pad: string,
): string | null {
  switch (action.keyword) {
    case "open_page":
      return `${pad}page.goto("${escPy(action.url)}")`;

    case "click":
      return `${pad}${POM_VAR}.${field(action.target, registry)}.click()`;

    case "fill":
      return `${pad}${POM_VAR}.${field(action.target, registry)}.fill("${escPy(action.value)}")`;

    case "select":
      return `${pad}${POM_VAR}.${field(action.target, registry)}.select_option("${escPy(action.value)}")`;

    case "verify_text":
      if (action.target) {
        return `${pad}expect(${POM_VAR}.${field(action.target, registry)}).to_contain_text("${escPy(action.text)}")`;
      }
      return `${pad}expect(page.get_by_text("${escPy(action.text)}")).to_be_visible()`;

    case "verify_url":
      return `${pad}expect(page).to_have_url("${escPy(action.pattern)}")`;

    case "wait_for": {
      if (action.strategy === "network-idle") return `${pad}page.wait_for_load_state("networkidle")`;
      if (action.strategy === "route-change")  return `${pad}page.wait_for_url("**")`;
      if (action.target) return `${pad}${POM_VAR}.${field(action.target, registry)}.wait_for(state="visible")`;
      return `${pad}page.wait_for_load_state("domcontentloaded")`;
    }

    case "upload_file":
      return `${pad}${POM_VAR}.${field(action.target, registry)}.set_input_files("${escPy(action.filePath)}")`;

    case "drag_drop":
      return `${pad}${POM_VAR}.${field((action as { source: Locator }).source, registry)}.drag_to(${POM_VAR}.${field(action.target, registry)})`;

    case "type_keyboard":
      return `${pad}page.keyboard.press("${escPy(action.keys)}")`;

    case "scroll_to":
      return `${pad}${POM_VAR}.${field(action.target, registry)}.scroll_into_view_if_needed()`;

    case "verify_screenshot":
      return `${pad}expect(page).to_have_screenshot("${escPy(action.name)}.png")`;

    default:
      return null;
  }
}

function field(loc: Locator, registry: LocatorRegistry): string {
  const entry = registry.get(locatorKey(loc));
  if (entry) return entry.fieldName;
  // Fallback: inline expression (should rarely happen)
  return locatorToPyExpr(loc, "page");
}

// ---------------------------------------------------------------------------
// ExpectedResult → Python assertion lines
// ---------------------------------------------------------------------------

function expectedResultToPy(
  expected: ExpectedResult,
  registry: LocatorRegistry,
  pad: string,
): string[] {
  const lines: string[] = [];

  const locExpr = (loc: Locator): string => {
    const e = registry.get(locatorKey(loc));
    return e ? `${POM_VAR}.${e.fieldName}` : locatorToPyExpr(loc, "page");
  };

  if (expected.url)
    lines.push(`${pad}expect(page).to_have_url("${escPy(expected.url)}")`);
  if (expected.text)
    lines.push(`${pad}expect(page.get_by_text("${escPy(expected.text)}")).to_be_visible()`);
  if (expected.visibleLocator)
    lines.push(`${pad}expect(${locExpr(expected.visibleLocator)}).to_be_visible()`);
  for (const vl of expected.visibleLocators ?? [])
    lines.push(`${pad}expect(${locExpr(vl)}).to_be_visible()`);
  for (const nvl of expected.notVisibleLocators ?? [])
    lines.push(`${pad}expect(${locExpr(nvl)}).not_to_be_visible()`);
  if (expected.urlNotContains)
    lines.push(`${pad}expect(page).not_to_have_url(re.compile(r"${escPyRe(expected.urlNotContains)}"))`);
  if (expected.textNotContains)
    lines.push(`${pad}expect(page.get_by_text("${escPy(expected.textNotContains)}")).not_to_be_visible()`);
  if (expected.attribute) {
    const expr = locExpr(expected.attribute.target);
    if (expected.attribute.equals !== undefined)
      lines.push(`${pad}expect(${expr}).to_have_attribute("${escPy(expected.attribute.name)}", "${escPy(expected.attribute.equals)}")`);
    else if (expected.attribute.contains !== undefined)
      lines.push(`${pad}expect(${expr}).to_have_attribute("${escPy(expected.attribute.name)}", re.compile(r"${escPyRe(expected.attribute.contains)}"))`);
  }
  if (expected.childCount?.min !== undefined)
    lines.push(`${pad}expect(${locExpr(expected.childCount.target)}.locator("*")).to_have_count(${expected.childCount.min})`);

  return lines;
}

// ---------------------------------------------------------------------------
// Playwright Python locator expression  (used in POM __init__ only)
// ---------------------------------------------------------------------------

function locatorToPyExpr(loc: Locator, ctx: string): string {
  switch (loc.kind) {
    case "role":
      return loc.name
        ? `${ctx}.get_by_role("${loc.role}", name="${escPy(loc.name)}")`
        : `${ctx}.get_by_role("${loc.role}")`;
    case "label":  return `${ctx}.get_by_label("${escPy(loc.text)}")`;
    case "text":   return `${ctx}.get_by_text("${escPy(loc.text)}")`;
    case "testId": return `${ctx}.get_by_test_id("${escPy(loc.value)}")`;
    default:       return `${ctx}.locator("[data-unknown]")`;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function derivePageTitle(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/$/, "") || "/";
    const parts = p === "/" ? [u.hostname] : p.split("/").filter(Boolean);
    return parts.join(" ").replace(/-/g, " ");
  } catch {
    return url;
  }
}

function toPascalCase(label: string): string {
  return label
    .replace(/[^a-zA-Z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function toSnake(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function shortHash(scenario: ExecutableScenario): string {
  const content = JSON.stringify({ id: scenario.id, title: scenario.title, steps: scenario.steps });
  // Simple djb2 hash — avoids importing crypto in this generator
  let h = 5381;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) + h) ^ content.charCodeAt(i);
    h >>>= 0;
  }
  return h.toString(16).slice(0, 8).padStart(8, "0");
}

function escPy(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escPyRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
