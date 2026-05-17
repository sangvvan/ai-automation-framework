import type {
  Action,
  ExecutableScenario,
  Locator,
  PageAnalysis,
  PageElement,
  ScenarioStep,
  ScenarioWarning,
} from "../validation";

export interface MapResult {
  steps: ScenarioStep[];
  warnings: ScenarioWarning[];
}

/**
 * Heuristic natural-language → keyword action mapper.
 * Rules (case-insensitive):
 *   "open <url>"                 → open_page
 *   "navigate to <url>"          → open_page
 *   "click <label>"              → click(role/text)
 *   "press <label>" / "tap"      → click
 *   "enter <value> [in|into|as] <field>" → fill
 *   "fill <field> with <value>"  → fill
 *   "select <value> [from] <field>" → select
 *   "verify [text] <text>"       → verify_text
 *   "check url <pattern>"        → verify_url
 *   "should see <text>"          → verify_text
 *   "wait for <label>"           → wait_for
 */
export function mapStepsToActions(
  steps: ScenarioStep[],
  analysis: PageAnalysis | undefined,
  pageUrl: string,
): MapResult {
  const out: ScenarioStep[] = [];
  const warnings: ScenarioWarning[] = [];

  for (const step of steps) {
    const phrase = step.description.trim();
    const mapped = mapPhrase(phrase, analysis, pageUrl);
    if (mapped.action) {
      out.push({ ...step, action: mapped.action, resolved: mapped.resolved });
      if (!mapped.resolved) {
        warnings.push({ stepIndex: step.index, reason: mapped.reason ?? "unresolved" });
      }
    } else {
      // keep original action but mark unresolved
      out.push({ ...step, resolved: false });
      warnings.push({
        stepIndex: step.index,
        reason: mapped.reason ?? "no matching element",
      });
    }
  }

  return { steps: out, warnings };
}

interface MapOutcome {
  action?: Action;
  resolved: boolean;
  reason?: string;
}

function mapPhrase(
  phrase: string,
  analysis: PageAnalysis | undefined,
  pageUrl: string,
): MapOutcome {
  const lower = phrase.toLowerCase();

  // open_page
  let m = phrase.match(/^(?:open|navigate to|go to)\s+(?:the\s+)?(\S+)/i);
  if (m) {
    const url = isLikelyUrl(m[1]) ? m[1] : pageUrl;
    return { action: { keyword: "open_page", url }, resolved: true };
  }
  if (/^open\s+(?:login|register|home|page)/i.test(phrase)) {
    return { action: { keyword: "open_page", url: pageUrl }, resolved: true };
  }

  // verify_url
  m = phrase.match(/(?:url should be|verify url|check url)\s+(.+)/i);
  if (m) {
    return { action: { keyword: "verify_url", pattern: m[1].trim() }, resolved: true };
  }

  // verify_text
  m = phrase.match(/(?:verify(?: text)?|should see|see|expect text)\s+(.+)/i);
  if (m) {
    return { action: { keyword: "verify_text", text: m[1].trim() }, resolved: true };
  }

  // click / press / tap
  m = phrase.match(/^(?:click|press|tap)\s+(?:on\s+)?(?:the\s+)?(.+)/i);
  if (m) {
    const name = stripTrailingNoun(m[1]);
    const locator = findLocator(analysis, name, ["button", "link"]);
    if (!locator) {
      return {
        action: { keyword: "click", target: { kind: "text", text: name } },
        resolved: false,
        reason: `no matching button or link for "${name}"`,
      };
    }
    return { action: { keyword: "click", target: locator }, resolved: true };
  }

  // fill: "enter <value> in <field>" / "fill <field> with <value>"
  m = phrase.match(/^(?:enter|type)\s+(.+?)\s+(?:in|into|as)\s+(?:the\s+)?(.+)/i);
  if (m) {
    return mkFill(m[2], m[1], analysis);
  }
  m = phrase.match(/^fill\s+(?:the\s+)?(.+?)\s+(?:with|=)\s+(.+)/i);
  if (m) {
    return mkFill(m[1], m[2], analysis);
  }
  // "enter valid username" → field=username, value=synthetic
  m = phrase.match(/^enter\s+(?:a\s+)?(?:valid|invalid|sample)\s+(.+)/i);
  if (m) {
    const field = m[1];
    const value = field.includes("password") ? "Password123!" : `test-${field}`;
    return mkFill(field, value, analysis);
  }

  // select
  m = phrase.match(/^select\s+(.+?)\s+(?:from|in)\s+(.+)/i);
  if (m) {
    const locator = findLocator(analysis, m[2], ["combobox"]);
    if (!locator) {
      return {
        action: {
          keyword: "select",
          target: { kind: "label", text: m[2] },
          value: m[1],
        },
        resolved: false,
        reason: `no matching dropdown for "${m[2]}"`,
      };
    }
    return {
      action: { keyword: "select", target: locator, value: m[1] },
      resolved: true,
    };
  }

  // wait_for
  m = phrase.match(/^wait for\s+(.+)/i);
  if (m) {
    const locator = findLocator(analysis, m[1]);
    if (!locator) {
      return {
        action: { keyword: "wait_for", target: { kind: "text", text: m[1] } },
        resolved: false,
        reason: `no matching element for wait_for "${m[1]}"`,
      };
    }
    return { action: { keyword: "wait_for", target: locator }, resolved: true };
  }

  return { resolved: false, reason: `unrecognized step phrase: "${phrase}"` };
}

function mkFill(
  field: string,
  value: string,
  analysis: PageAnalysis | undefined,
): MapOutcome {
  const locator = findLocator(analysis, field, ["textbox", "searchbox"]);
  if (!locator) {
    return {
      action: { keyword: "fill", target: { kind: "label", text: field }, value },
      resolved: false,
      reason: `no matching input for "${field}"`,
    };
  }
  return { action: { keyword: "fill", target: locator, value }, resolved: true };
}

function findLocator(
  analysis: PageAnalysis | undefined,
  needle: string,
  preferredRoles?: string[],
): Locator | undefined {
  if (!analysis) return undefined;
  const norm = needle.trim().toLowerCase().replace(/\s+/g, " ");
  // 1. exact match by accessible name (role-preferred)
  const candidates = analysis.elements.filter((e) =>
    matchesName(e, norm) && (!preferredRoles || matchesRole(e, preferredRoles)),
  );
  if (candidates.length) return pick(candidates);
  // 2. any element by name
  const any = analysis.elements.filter((e) => matchesName(e, norm));
  if (any.length) return pick(any);
  return undefined;
}

function matchesName(e: PageElement, needle: string): boolean {
  const name = (e.accessibleName ?? "").toLowerCase();
  return (
    name === needle ||
    name.includes(needle) ||
    (e.locator.kind === "label" && e.locator.text.toLowerCase().includes(needle))
  );
}

function matchesRole(e: PageElement, roles: string[]): boolean {
  if (e.locator.kind === "role") return roles.includes(e.locator.role);
  return false;
}

function pick(els: PageElement[]): Locator {
  return els[0].locator;
}

function stripTrailingNoun(s: string): string {
  return s.replace(/\s+(button|link|tab)$/i, "").trim();
}

function isLikelyUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

/** Convenience: re-assemble scenario with mapped steps + warnings. */
export function rebuildScenario(
  scenario: ExecutableScenario,
  res: MapResult,
): ExecutableScenario {
  return { ...scenario, steps: res.steps, warnings: res.warnings };
}
