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

export interface DesignOptions {
  analysis: PageAnalysis;
  acceptanceCriteria?: string[];
  businessRules?: string[];
  maxScenarios?: number;
  categories?: string[];
  /** Restrict generation to a subset of ISTQB techniques (REQ-012). */
  requestedTechniques?: DesignTechniqueType[];
  provider: AiProvider;
}

// Schema the model must return.
const GeneratedScenarioModel = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: ScenarioType,
  priority: Priority,
  designTechnique: DesignTechnique.optional(),
  steps: z
    .array(
      z.object({
        description: z.string().min(1),
        action: Action,
      }),
    )
    .min(1),
  expectedResult: ExpectedResult,
});
const ModelOutput = z.object({
  scenarios: z.array(GeneratedScenarioModel),
});

const SYSTEM = `You are a meticulous QA test designer. Given a PageAnalysis JSON
describing a web page (URL, title, interactive elements with semantic locators,
forms, navigation), produce concise, executable test scenarios.

Rules:
1. Output a single JSON object: { "scenarios": [ ... ] }.
2. Each scenario must have id, title, type (one of: positive, negative,
   required-field, boundary, navigation, ui, error-handling, accessibility,
   security), priority (P1|P2|P3), steps[], expectedResult, and optionally designTechnique
   (one of: equivalence-partition, boundary-value, decision-table, state-transition,
   use-case, pairwise, error-guessing, exploratory-charter).
3. Every step in steps[] MUST BE AN OBJECT with "description" (string) and "action" (object).
   The "description" string MUST strictly use one of these phrasing templates:
   - "open <url>"
   - "click <name>"
   - "enter <value> in <field>"
   - "select <value> from <field>"
   - "verify text <text>"
   - "check url <pattern>"
   The "action" object MUST match this schema:
   {"keyword": "click", "target": {"kind": "role", "role": "button", "name": "Submit"}}
   or {"keyword": "fill", "target": {"kind": "label", "text": "Email"}, "value": "test@example.com"}
   or {"keyword": "open_page", "url": "..."}
   or {"keyword": "verify_url", "url": "..."}
   or {"keyword": "verify_text", "text": "Success"}
   expectedResult MUST BE AN OBJECT matching:
   {"type": "page_url", "url": "..."} OR {"type": "element_visible", "locator": {...}} OR {"type": "text_present", "text": "..."}
4. Every locator referenced in steps must correspond to an element present
   in the supplied PageAnalysis. Prefer role+name; fall back to label.
5. Use ONLY synthetic placeholder values for fills (e.g. test-user@example.com,
   Password123!) — never copy values you observe on the page.
6. Cover all categories you can; do not exceed maxScenarios.`;

export async function designScenarios(
  opts: DesignOptions,
): Promise<ExecutableScenarioType[]> {
  const max = opts.maxScenarios ?? 25;
  const requested =
    opts.requestedTechniques && opts.requestedTechniques.length
      ? opts.requestedTechniques
      : ALL_TECHNIQUES;

  const validNames = new Set(opts.analysis.elements.map((e) => normalize(e.accessibleName)));
  const out: ExecutableScenarioType[] = [];

  // Per-technique cap so each technique gets a fair share of the budget.
  const perTechniqueCap = Math.max(
    1,
    Math.floor(max / requested.length) + (max % requested.length ? 1 : 0),
  );

  for (const technique of requested) {
    if (out.length >= max) break;
    const systemPrompt = `${SYSTEM}\n${TECHNIQUE_ADDENDA[technique]}`;
    const userPrompt = buildUserPrompt({ ...opts, maxScenarios: perTechniqueCap });
    let result: { scenarios: Array<z.infer<typeof GeneratedScenarioModel>> };
    try {
      result = await opts.provider.generateStructured({
        systemPrompt,
        userPrompt,
        schema: ModelOutput,
      });
    } catch {
      // Skip techniques the provider can't satisfy; keep going.
      continue;
    }

    for (const raw of result.scenarios) {
      if (out.length >= max) break;
      const steps: import("../../validation").ScenarioStep[] = raw.steps.map((s, i) => {
        const step: import("../../validation").ScenarioStep = {
          index: i,
          description: s.description,
          action: groundAction(s.action, opts.analysis) ?? s.action,
          resolved: isResolved(s.action, opts.analysis, validNames),
        };
        return ScenarioStep.parse(step);
      });
      const scenario: ExecutableScenarioType = {
        id: raw.id || `GEN_${technique}_${randomUUID().slice(0, 8)}`,
        title: raw.title,
        type: raw.type,
        priority: raw.priority,
        pageUrl: opts.analysis.url,
        steps,
        expectedResult: raw.expectedResult,
        origin: "ai-generated",
        designTechnique: technique,
        warnings: steps
          .filter((s) => !s.resolved)
          .map((s) => ({ stepIndex: s.index, reason: "AI step referenced unknown element" })),
      };
      out.push(ExecutableScenario.parse(scenario));
    }
  }
  return out;
}

function buildUserPrompt(opts: DesignOptions): string {
  const slim = {
    url: opts.analysis.url,
    title: opts.analysis.title,
    forms: opts.analysis.forms,
    elements: opts.analysis.elements
      .filter((e) => e.isVisible)
      .map((e) => ({
        tag: e.tag,
        type: e.type,
        locator: e.locator,
        accessibleName: e.accessibleName,
        isRequired: e.isRequired,
        isSensitive: e.isSensitive,
      })),
  };
  return JSON.stringify(
    {
      pageAnalysis: slim,
      maxScenarios: opts.maxScenarios ?? 25,
      categories: opts.categories,
      acceptanceCriteria: opts.acceptanceCriteria,
      businessRules: opts.businessRules,
    },
    null,
    2,
  );
}

function groundAction(action: Action, analysis: PageAnalysis): Action | undefined {
  if (
    action.keyword === "open_page" ||
    action.keyword === "verify_url" ||
    (action.keyword === "verify_text" && !action.target)
  ) {
    return action;
  }
  const target = "target" in action ? action.target : undefined;
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
    (action.keyword === "verify_text" && !action.target)
  ) {
    return true;
  }
  const target = "target" in action ? action.target : undefined;
  if (!target) return true;
  if (findElementByLocator(analysis.elements, target)) return true;
  const candidate = locatorText(target);
  return candidate ? validNames.has(normalize(candidate)) : false;
}

function findElementByLocator(
  elements: PageElement[],
  loc: Locator,
): PageElement | undefined {
  return elements.find((e) => sameLocator(e.locator, loc));
}

function sameLocator(a: Locator, b: Locator): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "role" && b.kind === "role") {
    return a.role === b.role && (a.name ?? "") === (b.name ?? "");
  }
  if (a.kind === "label" && b.kind === "label") return a.text === b.text;
  if (a.kind === "text" && b.kind === "text") return a.text === b.text;
  if (a.kind === "testId" && b.kind === "testId") return a.value === b.value;
  return false;
}

function locatorText(loc: Locator): string | undefined {
  switch (loc.kind) {
    case "role":
      return loc.name;
    case "label":
    case "text":
      return loc.text;
    case "testId":
      return loc.value;
  }
}

function normalize(s: string | undefined): string {
  return (s ?? "").toLowerCase().trim();
}
