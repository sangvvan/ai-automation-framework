/**
 * Non-Functional Test Design Agent
 *
 * Generates test cases for quality characteristics that functional ISTQB
 * techniques do not naturally produce:
 *
 *   • Accessibility  (WCAG 2.1 AA / ISO 25010 §6.4)
 *   • Security       (OWASP Top 10 / ISO 25010 §6.5)
 *   • Performance    (Core Web Vitals / ISO 25010 §6.2)
 *   • Usability      (ISO 25010 §6.3)
 *   • Compatibility  (ISO 25010 §6.6)
 *
 * Each category gets its own AI call so the model can focus its context window.
 * All generated scenarios are valid ExecutableScenario objects and are merged
 * into the same page manifest as functional scenarios.
 */

import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  ExecutableScenario,
  type ExecutableScenario as ExecutableScenarioType,
  Action,
  Locator,
  ExpectedResult,
  ScenarioType,
  Priority,
  ScenarioStep,
  type PageAnalysis,
} from "../../validation";
import type { AiProvider } from "../provider";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type NonFunctionalCategory =
  | "accessibility"
  | "security"
  | "performance"
  | "usability"
  | "compatibility";

export interface NonFunctionalDesignOptions {
  analysis: PageAnalysis;
  /** Which non-functional categories to generate (default: all 5). */
  categories?: NonFunctionalCategory[];
  /** Scenarios per category (default 2 — keeps token usage manageable). */
  scenariosPerCategory?: number;
  provider: AiProvider;
}

/** All non-functional categories, priority-ordered. */
export const ALL_NF_CATEGORIES: NonFunctionalCategory[] = [
  "accessibility",
  "security",
  "performance",
  "usability",
  "compatibility",
];

// ---------------------------------------------------------------------------
// Per-category system-prompt addenda
// ---------------------------------------------------------------------------

const NF_ADDENDA: Record<NonFunctionalCategory, string> = {

  accessibility: `
NON-FUNCTIONAL: Accessibility Testing (WCAG 2.1 AA / ISO 25010 §6.4)
Reference: https://www.w3.org/TR/WCAG21/

Generate test cases verifying the page is usable by people with disabilities.

REQUIRED CHECKS (cover as many as apply to this page):
1. Keyboard navigation
   - Tab order is logical and visible
   - All interactive elements reachable by keyboard alone
   - No keyboard trap exists
2. Screen-reader compatibility
   - Inputs have visible labels (verify label text is present)
   - Buttons have descriptive accessible names
   - Form errors are announced (verify error text visible)
3. Colour & contrast (observable via page content)
   - Error messages use both colour AND text (not colour alone)
4. Forms
   - Required fields are indicated (asterisk or "required" text visible)
   - Error messages are adjacent to the relevant field
5. Images (if any)
   - Alt text is present (verify img element is not the only indicator)

ACTIONS TO USE:
- open_page + verify_text to check label presence
- scroll_to to check element visibility
- verify_text to assert accessible names and error text

Type for all scenarios: "accessibility", Priority: P1 or P2.`,

  security: `
NON-FUNCTIONAL: Security Testing (OWASP Top 10 / ISO 25010 §6.5)
Reference: https://owasp.org/Top10/

Generate test cases probing for common web vulnerabilities on this page.

REQUIRED CHECKS (cover those applicable to this page's features):
1. Input validation / Injection (OWASP A03)
   - Try SQL injection payload: " OR 1=1 --
   - Try XSS payload: <script>alert(1)</script>
   - Try path traversal: ../../etc/passwd
   - Expected: input is rejected or sanitised (no script execution, no DB error)
2. Authentication & authorisation (OWASP A01, A07)
   - Access protected URLs directly without login → expect redirect to login
   - Attempt to access another user's resource by changing URL ID → expect 403/404
3. Sensitive data exposure (OWASP A02)
   - Password fields must use type=password (not visible in DOM)
   - API keys / tokens must not appear in page source
4. Security headers (OWASP A05)
   - Verify page does not expose server version in visible content
5. CSRF (OWASP A01)
   - Form submissions should include a hidden token field (verify its presence)

ACTIONS TO USE:
- open_page, fill (with injection payloads), click (submit), verify_text (error msg)
- verify_url (confirm redirect to login page)

Type for all scenarios: "security", Priority: P1.`,

  performance: `
NON-FUNCTIONAL: Performance Testing (Core Web Vitals / ISO 25010 §6.2)
Reference: https://web.dev/vitals/

Generate test cases verifying the page loads and responds within acceptable thresholds.

REQUIRED CHECKS:
1. Page load
   - Page renders without blank screen (verify_text of main heading or nav)
   - Key content is visible above the fold (scroll_to not required to see it)
2. Interaction responsiveness
   - After clicking a button that triggers data load, content appears promptly
   - Use wait_for network-idle before asserting content loaded
3. Empty / loading states
   - If data is loading, a loading indicator is shown (verify_text "Loading")
   - After load completes, loading indicator disappears (textNotContains: "Loading")
4. Large data handling
   - If the page has a list/table, verify it renders with reasonable row count
5. Navigation timing
   - After navigating to a sub-page, the URL changes and new page renders

STEP PATTERN for performance checks:
  open_page → wait_for(network-idle) → verify_text(main content) → [assert no spinner]

Type for all scenarios: "performance", Priority: P2.`,

  usability: `
NON-FUNCTIONAL: Usability Testing (ISO 25010 §6.3 / Nielsen Heuristics)

Generate test cases verifying the page is easy to understand and use.

REQUIRED CHECKS:
1. First-impression clarity
   - Page title/heading clearly describes the page's purpose
   - Primary action (main button/CTA) is immediately visible
2. Form usability
   - Placeholder text or labels guide users on expected input format
   - Required fields are marked before submission attempt
   - After error, the correct field retains focus (error message visible)
3. Feedback & status
   - Success actions show a confirmation message
   - Destructive actions (delete) require confirmation step
4. Empty state
   - If no data matches a filter/search, a helpful empty-state message is shown
5. Consistent navigation
   - Navigation links use descriptive text (not just "click here")
   - Logo or home link returns to home page

Type for all scenarios: "usability" or "ui", Priority: P2 or P3.`,

  compatibility: `
NON-FUNCTIONAL: Compatibility Testing (ISO 25010 §6.6)

Generate test cases verifying the page works correctly across configurations.

REQUIRED CHECKS (generate scenarios for those relevant to this page):
1. Viewport / responsive design
   - Page is usable at 1280×800 (desktop) — verify no horizontal scroll
   - Critical elements remain visible and clickable (no overlap)
2. Content independence
   - Page works with JavaScript errors in console (test graceful degradation
     by verifying core content is present without JS interaction)
3. URL structure
   - Direct URL access (open_page with the exact URL) renders correct content
   - URL with extra query parameters does not break the page
4. Browser back / forward
   - Navigating forward then using browser back returns to correct page state
5. Print / download (if applicable)
   - Printable content is available (verify_text on print-friendly region)

Type for all scenarios: "compatibility" or "navigation", Priority: P2 or P3.`,
};

// ---------------------------------------------------------------------------
// Shared raw schema (same lenient pattern as test-design.ts)
// ---------------------------------------------------------------------------

const RawActionSchema = z.record(z.unknown());
const RawStepSchema = z.object({
  description: z.string().min(1),
  action: RawActionSchema,
});
const RawScenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: z.string().default("accessibility"),
  priority: z.string().default("P2"),
  steps: z.array(RawStepSchema).min(1),
  expectedResult: z.record(z.unknown()).default({}),
});
const ModelOutput = z.object({ scenarios: z.array(RawScenarioSchema) });

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM = `You are a senior QA engineer specialising in non-functional testing.
Given a PageAnalysis JSON, generate EXECUTABLE Playwright test scenarios for a
specific quality characteristic.

OUTPUT FORMAT — strict JSON only:
{
  "scenarios": [
    {
      "id": "NF-A11Y-001",
      "title": "All form inputs have visible labels",
      "type": "accessibility",
      "priority": "P1",
      "steps": [
        {"description": "open <url>", "action": {"keyword": "open_page", "url": "..."}},
        {"description": "verify text Email", "action": {"keyword": "verify_text", "text": "Email"}}
      ],
      "expectedResult": {"text": "Email"}
    }
  ]
}

ACTION KEYWORDS (only these):
  {"keyword": "open_page",   "url": "..."}
  {"keyword": "click",       "target": {"kind": "role", "role": "...", "name": "..."}}
  {"keyword": "fill",        "target": {"kind": "label", "text": "..."}, "value": "..."}
  {"keyword": "verify_text", "text": "..."}
  {"keyword": "verify_url",  "pattern": "..."}
  {"keyword": "wait_for",    "strategy": "network-idle"}
  {"keyword": "scroll_to",   "target": {"kind": "role", "role": "...", "name": "..."}}

EXPECTED RESULT:
  {"text": "..."}              — text is visible on page
  {"url": "/path"}             — URL contains path
  {"textNotContains": "..."}   — text is NOT visible
  {"urlNotContains": "/login"} — URL does not contain

RULES:
1. Only reference elements present in the PageAnalysis.
2. Every scenario needs at least open_page + one verify step.
3. Do not exceed maxScenarios.`;

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function designNonFunctionalScenarios(
  opts: NonFunctionalDesignOptions,
): Promise<ExecutableScenarioType[]> {
  const categories = opts.categories ?? ALL_NF_CATEGORIES;
  const perCat = opts.scenariosPerCategory ?? 2;

  const out: ExecutableScenarioType[] = [];
  const errors: Array<{ category: NonFunctionalCategory; error: Error }> = [];

  for (const category of categories) {
    const systemPrompt = `${SYSTEM}\n\n${"═".repeat(63)}\n${NF_ADDENDA[category]}`;
    const userPrompt = buildUserPrompt(opts.analysis, perCat);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let result: any;
    try {
      result = await opts.provider.generateStructured({
        systemPrompt,
        userPrompt,
        schema: ModelOutput,
      });
    } catch (err) {
      console.warn(
        `[non-functional] "${category}" failed: ${(err as Error).message.slice(0, 120)}`,
      );
      errors.push({ category, error: err as Error });
      continue;
    }

    for (const raw of (result.scenarios ?? [])) {
      const steps: import("../../validation").ScenarioStep[] = [];
      for (const [i, s] of (raw.steps ?? []).entries()) {
        const actionResult = Action.safeParse(s.action);
        const action: import("../../validation").Action = actionResult.success
          ? actionResult.data
          : coerceFallbackAction(s.action as Record<string, unknown>, opts.analysis.url);

        const step = ScenarioStep.safeParse({
          index: i,
          description: s.description,
          action,
          resolved: actionResult.success,
        });
        if (step.success) steps.push(step.data);
      }
      if (steps.length === 0) continue;

      const scenarioType = ScenarioType.safeParse(raw.type).success
        ? (raw.type as import("../../validation").ScenarioType)
        : (category as import("../../validation").ScenarioType);
      const scenarioPriority = Priority.safeParse(raw.priority).success
        ? (raw.priority as import("../../validation").Priority)
        : ("P2" as const);
      const expectedResult = coerceExpectedResult(
        (raw.expectedResult ?? {}) as Record<string, unknown>,
      );

      const nfPrefix = category.slice(0, 4).toUpperCase();
      const scenario = ExecutableScenario.safeParse({
        id: raw.id || `NF-${nfPrefix}-${randomUUID().slice(0, 8)}`,
        title: raw.title,
        type: scenarioType,
        priority: scenarioPriority,
        pageUrl: opts.analysis.url,
        steps,
        expectedResult,
        origin: "ai-generated",
        warnings: [],
      });

      if (scenario.success) {
        out.push(scenario.data);
      } else {
        console.warn(
          `[non-functional] Skipping "${raw.id}": ${scenario.error.message.slice(0, 150)}`,
        );
      }
    }
  }

  // Non-functional failures are non-fatal — return what we have
  if (errors.length > 0 && out.length === 0) {
    console.warn(
      `[non-functional] All categories failed for ${opts.analysis.url}: ` +
      errors.map((e) => `[${e.category}] ${e.error.message}`).join("; "),
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUserPrompt(analysis: PageAnalysis, maxScenarios: number): string {
  return JSON.stringify(
    {
      pageAnalysis: {
        url: analysis.url,
        title: analysis.title,
        forms: analysis.forms,
        elements: analysis.elements
          .filter((e) => e.isVisible)
          .map((e) => ({
            tag: e.tag,
            type: e.type,
            locator: e.locator,
            accessibleName: e.accessibleName,
            isRequired: e.isRequired,
            isSensitive: e.isSensitive,
          })),
      },
      maxScenarios,
    },
    null,
    2,
  );
}

function coerceFallbackAction(
  raw: Record<string, unknown>,
  pageUrl: string,
): import("../../validation").Action {
  const text =
    typeof raw.text === "string"     ? raw.text :
    typeof raw.expected === "string" ? raw.expected : null;
  if (text) return { keyword: "verify_text", text };

  const pattern =
    typeof raw.url === "string"     ? raw.url :
    typeof raw.pattern === "string" ? raw.pattern : null;
  if (pattern) return { keyword: "verify_url", pattern };

  const targetRaw = raw.target ?? raw.locator ?? raw.element;
  if (targetRaw && typeof targetRaw === "object") {
    const loc = Locator.safeParse(targetRaw);
    if (loc.success) return { keyword: "click", target: loc.data };
  }

  return { keyword: "open_page", url: pageUrl };
}

function coerceExpectedResult(
  raw: Record<string, unknown>,
): import("../../validation").ExpectedResult {
  const direct = ExpectedResult.safeParse(raw);
  if (direct.success) return direct.data;

  const out: Record<string, unknown> = {};
  if (raw.type === "page_url" && typeof raw.url === "string") out.url = raw.url;
  else if (raw.type === "text_present" && typeof raw.text === "string") out.text = raw.text;
  else if (raw.type === "element_visible") {
    const locRaw = raw.locator ?? raw.element ?? raw.target;
    if (locRaw) {
      const loc = Locator.safeParse(locRaw);
      if (loc.success) out.visibleLocator = loc.data;
    }
  } else {
    if (typeof raw.url === "string")  out.url  = raw.url;
    if (typeof raw.text === "string") out.text = raw.text;
    const locRaw = raw.visibleLocator ?? raw.locator;
    if (locRaw) {
      const loc = Locator.safeParse(locRaw);
      if (loc.success) out.visibleLocator = loc.data;
    }
  }

  return ExpectedResult.safeParse(out).success ? ExpectedResult.parse(out) : {};
}
