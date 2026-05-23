import type { ExecutableScenario } from "../validation";

export interface AssembledSuite {
  /** Synthetic id only; the persistent uuid is assigned at DB insert. */
  tempId: string;
  name: string;
  featureSlug: string;
  preconditions?: string;
  regressionTag?: string;
  scenarios: ExecutableScenario[];
}

const AD_HOC_NAME = "Ad-hoc";

/**
 * Group scenarios into suites. Default rule: one suite per page URL
 * (pageUrl.pathname → feature slug). Scenarios without a recognisable
 * page (or whose URL has been collapsed) attach to a singleton
 * `Ad-hoc` suite.
 */
export function assembleSuites(scenarios: ExecutableScenario[]): AssembledSuite[] {
  const byKey = new Map<string, AssembledSuite>();
  for (const s of scenarios) {
    const key = featureKey(s);
    let suite = byKey.get(key);
    if (!suite) {
      suite = {
        tempId: key,
        name: humanize(key),
        featureSlug: slugify(key),
        scenarios: [],
      };
      byKey.set(key, suite);
    }
    suite.scenarios.push(s);
  }

  // If only one suite exists and it's the fallback Ad-hoc, keep that name.
  if (byKey.size === 0) {
    return [
      {
        tempId: "ad-hoc",
        name: AD_HOC_NAME,
        featureSlug: "ad-hoc",
        scenarios: [],
      },
    ];
  }
  return [...byKey.values()];
}

function featureKey(s: ExecutableScenario): string {
  try {
    const url = new URL(s.pageUrl);
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    return path || "home";
  } catch {
    return AD_HOC_NAME.toLowerCase();
  }
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "feature";
}

function humanize(s: string): string {
  if (s === AD_HOC_NAME.toLowerCase()) return AD_HOC_NAME;
  return s
    .split(/[\/-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || AD_HOC_NAME;
}
