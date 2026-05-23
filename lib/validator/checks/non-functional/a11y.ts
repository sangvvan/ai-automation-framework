import type { Page } from "@playwright/test";
import type { A11yViolation, ValidationCheck } from "../../../validation";

export interface AxeOptions {
  /** Severity gate — when set, violations at these impacts fail the check. */
  failOn?: ("minor" | "moderate" | "serious" | "critical")[];
}

interface AxeRawNode {
  target?: unknown[];
}
interface AxeRawViolation {
  id: string;
  impact: "minor" | "moderate" | "serious" | "critical";
  help: string;
  helpUrl?: string;
  nodes?: AxeRawNode[];
}

/**
 * Run axe-core against the current page. Imported lazily so framework
 * users not needing a11y don't pay the dependency cost.
 *
 * On any failure (axe not installed, import error, page closed),
 * returns an empty result with a `warn` check explaining the skip.
 */
export async function runA11yCheck(
  page: Page,
  opts: AxeOptions = {},
): Promise<{ violations: A11yViolation[]; check: ValidationCheck }> {
  let getViolations: ((page: Page) => Promise<unknown[]>) | undefined;
  let injectAxe: ((page: Page) => Promise<void>) | undefined;
  try {
    const mod = (await import("@axe-core/playwright")) as unknown as {
      default?: unknown;
      injectAxe?: (p: Page) => Promise<void>;
      getViolations?: (p: Page) => Promise<unknown[]>;
    };
    injectAxe = mod.injectAxe;
    getViolations = mod.getViolations;
  } catch {
    return {
      violations: [],
      check: {
        name: "accessibility",
        status: "warn",
        detail: "@axe-core/playwright not installed",
        category: "a11y",
      },
    };
  }
  if (!injectAxe || !getViolations) {
    return {
      violations: [],
      check: {
        name: "accessibility",
        status: "warn",
        detail: "axe-core helpers unavailable",
        category: "a11y",
      },
    };
  }

  try {
    await injectAxe(page);
    const raw = (await getViolations(page)) as AxeRawViolation[];
    const violations: A11yViolation[] = raw.map((v) => ({
      id: v.id,
      impact: v.impact,
      wcagLevel: impactToWcag(v.impact),
      help: v.help,
      helpUrl: v.helpUrl,
      nodes: (v.nodes ?? []).map((n) => JSON.stringify(n.target)).slice(0, 5),
    }));

    const failOn = opts.failOn ?? [];
    const blocking = violations.filter((v) => failOn.includes(v.impact));
    if (blocking.length > 0) {
      return {
        violations,
        check: {
          name: "accessibility",
          status: "failed",
          detail: `${blocking.length} ${failOn.join("/")} violations`,
          category: "a11y",
        },
      };
    }
    if (violations.length > 0) {
      return {
        violations,
        check: {
          name: "accessibility",
          status: "warn",
          detail: `${violations.length} violations (no failOn gate set)`,
          category: "a11y",
        },
      };
    }
    return {
      violations,
      check: {
        name: "accessibility",
        status: "passed",
        category: "a11y",
      },
    };
  } catch (err) {
    return {
      violations: [],
      check: {
        name: "accessibility",
        status: "warn",
        detail: `axe run failed: ${(err as Error).message.slice(0, 100)}`,
        category: "a11y",
      },
    };
  }
}

/**
 * Heuristic axe-impact → WCAG level (REQ-013 / ADR-009).
 * Documented in docs/testing-standard.md.
 */
export function impactToWcag(impact: "minor" | "moderate" | "serious" | "critical"): "A" | "AA" | "AAA" {
  if (impact === "minor") return "AAA";
  if (impact === "moderate") return "A";
  return "AA"; // serious + critical
}
