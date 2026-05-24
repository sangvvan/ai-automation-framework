import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  ExecutableScenario,
  type ExecutableScenario as ExecutableScenarioType,
  Priority,
  ScenarioStep,
  ScenarioType,
  ExpectedResult,
  Action,
  Locator,
  DesignTechnique,
  type DesignTechnique as DesignTechniqueType,
  type PageAnalysis,
  type PageElement,
} from "../../validation";
import type { AiProvider } from "../provider";
import { ALL_TECHNIQUES, TECHNIQUE_ADDENDA } from "../prompts/techniques";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DesignOptions {
  analysis: PageAnalysis;
  acceptanceCriteria?: string[];
  businessRules?: string[];
  /**
   * TOTAL max scenarios to keep (hard ceiling across all techniques).
   * @deprecated Prefer scenariosPerTechnique for predictable per-category coverage.
   */
  maxScenarios?: number;
  /**
   * How many scenarios to request PER TECHNIQUE (default: 3 for local models, 5 for cloud).
   * Overrides the old maxScenarios / N division so every technique gets a fair budget.
   */
  scenariosPerTechnique?: number;
  categories?: string[];
  /** Restrict to a subset of ISTQB techniques. Default: ALL_TECHNIQUES. */
  requestedTechniques?: DesignTechniqueType[];
  provider: AiProvider;
}

// ---------------------------------------------------------------------------
// Raw AI output schema — deliberately lenient
//
// Problem: for "decision-table" and similar techniques the AI generates steps
// with non-standard keywords (e.g. "verify_condition", "set_state"). Using the
// strict Action discriminated-union here causes every provider to throw
// ProviderError → whole technique fails → MockProvider reached.
//
// Solution: accept ANY object as an action at the schema-validation layer.
// Each step is re-validated against the strict Action schema in the building
// loop; unrecognised keywords get a graceful browser-executable fallback.
// ---------------------------------------------------------------------------

const RawActionSchema = z.record(z.unknown());

const RawStepSchema = z.object({
  description: z.string().min(1),
  action: RawActionSchema,
});

const RawScenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: z.string().default("positive"),
  priority: z.string().default("P2"),
  designTechnique: DesignTechnique.nullable().optional(),
  steps: z.array(RawStepSchema).min(1),
  expectedResult: z.record(z.unknown()).default({}),
});

const ModelOutput = z.object({
  scenarios: z.array(RawScenarioSchema),
});

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM = `You are a senior QA engineer applying ISTQB-CTFL v4.0 techniques.
Given a PageAnalysis JSON (URL, title, elements, forms), generate EXECUTABLE test
scenarios that can be run by Playwright.

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT — strict JSON, no markdown, no prose:
{
  "scenarios": [
    {
      "id":               "TC-001",
      "title":            "Submit login form with valid credentials",
      "type":             "positive",          // see types below
      "priority":         "P1",               // P1 | P2 | P3
      "designTechnique":  "equivalence-partition",
      "steps": [
        {
          "description": "open http://localhost:3000/login",
          "action": {"keyword": "open_page", "url": "http://localhost:3000/login"}
        },
        {
          "description": "enter test@example.com in Email",
          "action": {"keyword": "fill", "target": {"kind": "label", "text": "Email"}, "value": "test@example.com"}
        },
        {
          "description": "enter Password123! in Password",
          "action": {"keyword": "fill", "target": {"kind": "label", "text": "Password"}, "value": "Password123!"}
        },
        {
          "description": "click Sign In",
          "action": {"keyword": "click", "target": {"kind": "role", "role": "button", "name": "Sign In"}}
        }
      ],
      "expectedResult": {"url": "/dashboard"}
    }
  ]
}

═══════════════════════════════════════════════════════════════
SCENARIO TYPES (use exactly one per scenario):
  positive        — happy path, nominal inputs succeed
  negative        — invalid inputs produce correct error messages
  required-field  — missing mandatory field is rejected with error
  boundary        — values at the min/max edge of an accepted range
  navigation      — page transitions, redirects, back-button flows
  ui              — visual state: empty-state, loading, layout correctness
  error-handling  — network error, server error, timeout recovery
  security        — injection, auth bypass, IDOR, sensitive data exposure
  accessibility   — keyboard-only, screen-reader labels, focus order
  performance     — page load, first-contentful-paint, core web vitals

PRIORITY:
  P1 — Blocker: app unusable if this fails
  P2 — Major:   significant impact on user
  P3 — Minor:   cosmetic or edge case

═══════════════════════════════════════════════════════════════
ACTION KEYWORDS (use ONLY these):
  {"keyword": "open_page",   "url": "..."}
  {"keyword": "click",       "target": <locator>}
  {"keyword": "fill",        "target": <locator>, "value": "..."}
  {"keyword": "select",      "target": <locator>, "value": "..."}
  {"keyword": "verify_text", "text": "...", "target": <locator|omit>}
  {"keyword": "verify_url",  "pattern": "..."}
  {"keyword": "wait_for",    "strategy": "network-idle"}
  {"keyword": "scroll_to",   "target": <locator>}

LOCATOR KINDS:
  {"kind": "role",   "role": "button|link|textbox|...", "name": "label"}
  {"kind": "label",  "text": "field label text"}
  {"kind": "text",   "text": "visible text on page"}
  {"kind": "testId", "value": "data-testid value"}

EXPECTED RESULT (at least one field):
  {"url": "/path"}                           — page URL contains this
  {"text": "Success message"}                — text is visible
  {"visibleLocator": <locator>}              — element is visible
  {"urlNotContains": "/login"}               — URL does NOT contain
  {"textNotContains": "Error"}               — text is NOT visible

═══════════════════════════════════════════════════════════════
RULES:
1. Only reference elements that appear in the provided PageAnalysis.
2. For fills use SYNTHETIC data only: test@example.com, Password123!, John Doe.
3. Every negative/required-field scenario MUST verify the error message with verify_text.
4. Each scenario must have at least 2 steps (navigate + assert minimum).
5. Do NOT exceed maxScenarios in your response.`;

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function designScenarios(
  opts: DesignOptions,
): Promise<ExecutableScenarioType[]> {
  const requested =
    opts.requestedTechniques?.length ? opts.requestedTechniques : ALL_TECHNIQUES;

  // Per-technique budget: explicit > derived from maxScenarios > default 3
  const perTechniqueBudget =
    opts.scenariosPerTechnique ??
    (opts.maxScenarios ? Math.max(2, Math.ceil(opts.maxScenarios / requested.length)) : 3);

  const hardCeiling = opts.maxScenarios ?? requested.length * perTechniqueBudget;

  const validNames = new Set(opts.analysis.elements.map((e) => normalize(e.accessibleName)));
  const out: ExecutableScenarioType[] = [];
  const errors: Array<{ technique: DesignTechniqueType; error: Error }> = [];

  for (const technique of requested) {
    if (out.length >= hardCeiling) break;

    const systemPrompt = `${SYSTEM}\n\n${"═".repeat(63)}\n${TECHNIQUE_ADDENDA[technique]}`;
    const userPrompt = buildUserPrompt({ ...opts, maxScenarios: perTechniqueBudget });

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
        `[test-design] "${technique}" failed: ${(err as Error).message.slice(0, 120)}`,
      );
      errors.push({ technique, error: err as Error });
      continue;
    }

    for (const raw of (result.scenarios ?? [])) {
      if (out.length >= hardCeiling) break;

      // ── Coerce steps ────────────────────────────────────────────────────────
      const steps: import("../../validation").ScenarioStep[] = [];
      for (const [i, s] of (raw.steps ?? []).entries()) {
        const actionResult = Action.safeParse(s.action);
        const action: import("../../validation").Action = actionResult.success
          ? actionResult.data
          : coerceFallbackAction(s.action as Record<string, unknown>, opts.analysis.url);
        const grounded = groundAction(action, opts.analysis) ?? action;
        const step = ScenarioStep.safeParse({
          index: i,
          description: s.description,
          action: grounded,
          resolved: actionResult.success
            ? isResolved(action, opts.analysis, validNames)
            : false,
        });
        if (step.success) {
          steps.push(step.data);
        } else {
          console.warn(
            `[test-design] Skipping step ${i} of "${raw.id}": ${step.error.message.slice(0, 100)}`,
          );
        }
      }
      if (steps.length === 0) continue;

      // ── Coerce type / priority ───────────────────────────────────────────────
      const scenarioType = ScenarioType.safeParse(raw.type).success
        ? (raw.type as import("../../validation").ScenarioType)
        : ("positive" as const);
      const scenarioPriority = Priority.safeParse(raw.priority).success
        ? (raw.priority as import("../../validation").Priority)
        : ("P2" as const);

      // ── Coerce expectedResult ────────────────────────────────────────────────
      const expectedResult = coerceExpectedResult(
        (raw.expectedResult ?? {}) as Record<string, unknown>,
        opts.analysis.url,
      );

      const scenario = ExecutableScenario.safeParse({
        id: raw.id || `GEN_${technique}_${randomUUID().slice(0, 8)}`,
        title: raw.title,
        type: scenarioType,
        priority: scenarioPriority,
        pageUrl: opts.analysis.url,
        steps,
        expectedResult,
        origin: "ai-generated",
        designTechnique: technique,
        warnings: steps
          .filter((s) => !s.resolved)
          .map((s) => ({ stepIndex: s.index, reason: "AI step referenced unknown element" })),
      });

      if (scenario.success) {
        out.push(scenario.data);
      } else {
        console.warn(
          `[test-design] Skipping scenario "${raw.id}": ${scenario.error.message.slice(0, 200)}`,
        );
      }
    }
  }

  if (out.length === 0 && errors.length > 0) {
    throw new Error(
      `AI scenario generation failed for all techniques: ${errors
        .map((e) => `[${e.technique}] ${e.error.message}`)
        .join("; ")}`,
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// User prompt builder
// ---------------------------------------------------------------------------

function buildUserPrompt(opts: DesignOptions & { maxScenarios?: number }): string {
  const elements = opts.analysis.elements
    .filter((e) => e.isVisible)
    .map((e) => ({
      tag: e.tag,
      type: e.type,
      locator: e.locator,
      accessibleName: e.accessibleName,
      isRequired: e.isRequired,
      isSensitive: e.isSensitive,
    }));

  return JSON.stringify(
    {
      pageAnalysis: {
        url: opts.analysis.url,
        title: opts.analysis.title,
        forms: opts.analysis.forms,
        elements,
      },
      maxScenarios: opts.maxScenarios ?? 3,
      categories: opts.categories,
      acceptanceCriteria: opts.acceptanceCriteria,
      businessRules: opts.businessRules,
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Action grounding (map AI locators to real page elements)
// ---------------------------------------------------------------------------

function groundAction(action: Action, analysis: PageAnalysis): Action | undefined {
  if (
    action.keyword === "open_page" ||
    action.keyword === "verify_url" ||
    (action.keyword === "verify_text" && !action.target)
  ) {
    return action;
  }
  const target = "target" in action ? (action as { target: import("../../validation").Locator }).target : undefined;
  if (!target) return action;
  const match = findElementByLocator(analysis.elements, target);
  if (!match) return action;
  return { ...action, target: match.locator } as Action;
}

function isResolved(
  action: Action,
  analysis: PageAnalysis,
  validNames: Set<string>,
): boolean {
  if (
    action.keyword === "open_page" ||
    action.keyword === "verify_url" ||
    (action.keyword === "verify_text" && !(action as { target?: unknown }).target)
  ) {
    return true;
  }
  const target = "target" in action ? (action as { target: import("../../validation").Locator }).target : undefined;
  if (!target) return true;
  if (findElementByLocator(analysis.elements, target)) return true;
  const candidate = locatorText(target);
  return candidate ? validNames.has(normalize(candidate)) : false;
}

function findElementByLocator(
  elements: PageElement[],
  loc: import("../../validation").Locator,
): PageElement | undefined {
  return elements.find((e) => sameLocator(e.locator, loc));
}

function sameLocator(
  a: import("../../validation").Locator,
  b: import("../../validation").Locator,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "role" && b.kind === "role")
    return a.role === b.role && (a.name ?? "") === (b.name ?? "");
  if (a.kind === "label" && b.kind === "label") return a.text === b.text;
  if (a.kind === "text" && b.kind === "text") return a.text === b.text;
  if (a.kind === "testId" && b.kind === "testId") return a.value === b.value;
  return false;
}

function locatorText(loc: import("../../validation").Locator): string | undefined {
  switch (loc.kind) {
    case "role":   return loc.name;
    case "label":  return loc.text;
    case "text":   return loc.text;
    case "testId": return loc.value;
  }
}

function normalize(s: string | undefined): string {
  return (s ?? "").toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

/**
 * When the AI generates an action with an unrecognised keyword, map it to the
 * closest browser-executable equivalent rather than discarding the scenario.
 */
function coerceFallbackAction(
  raw: Record<string, unknown>,
  pageUrl: string,
): import("../../validation").Action {
  const text =
    typeof raw.text === "string"     ? raw.text :
    typeof raw.expected === "string" ? raw.expected :
    typeof raw.value === "string"    ? raw.value : null;
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

/**
 * Normalise the raw expectedResult object (AI may use {type,url} shape or
 * arbitrary fields) to our ExpectedResult schema shape. All fields optional
 * so an empty object is always valid — test will navigate and pass vacuously.
 */
function coerceExpectedResult(
  raw: Record<string, unknown>,
  _pageUrl: string,
): import("../../validation").ExpectedResult {
  const direct = ExpectedResult.safeParse(raw);
  if (direct.success) return direct.data;

  const out: Record<string, unknown> = {};

  if (raw.type === "page_url" && typeof raw.url === "string") {
    out.url = raw.url;
  } else if (raw.type === "text_present" && typeof raw.text === "string") {
    out.text = raw.text;
  } else if (raw.type === "element_visible") {
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

  return ExpectedResult.safeParse(out).success
    ? ExpectedResult.parse(out)
    : {};
}
