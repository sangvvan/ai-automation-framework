import type { Locator as PlaywrightLocator, Page } from "@playwright/test";
import type { Locator, PageElement } from "../validation";
import { resolveLocator } from "./resolver";
import { analyzePage } from "../analyzer/analyze";

export interface HealCandidate {
  locator: Locator;
  score: number;
}

export interface HealEvent {
  from: Locator;
  to: Locator;
  score: number;
  triedAt: string;
}

export interface HealResult {
  resolved: PlaywrightLocator;
  event: HealEvent;
}

const MIN_SCORE = 0.6;
const MAX_TRIALS = 3;

/**
 * Try to recover from a locator-not-found failure by re-analysing the
 * current page and scoring same-kind candidates against the original
 * locator (token Jaccard on the visible name).
 *
 * Returns the first candidate that actually resolves on the page, or
 * null if nothing fits.
 *
 * @param page         live Playwright page (still navigated)
 * @param original     the locator that failed to resolve
 * @param analyzerOpts options forwarded to analyzePage
 */
export async function tryHeal(
  page: Page,
  original: Locator,
  analyzerOpts: { screenshotPath: string },
): Promise<HealResult | null> {
  const analysis = await analyzePage({
    url: page.url(),
    screenshotPath: analyzerOpts.screenshotPath,
    headless: true,
  }).catch(() => null);
  if (!analysis) return null;

  const candidates = scoreCandidates(analysis.elements, original);
  for (const c of candidates.slice(0, MAX_TRIALS)) {
    if (c.score < MIN_SCORE) break;
    try {
      const pl = resolveLocator(page, c.locator).first();
      await pl.waitFor({ state: "visible", timeout: 1500 });
      return {
        resolved: pl,
        event: {
          from: original,
          to: c.locator,
          score: c.score,
          triedAt: new Date().toISOString(),
        },
      };
    } catch {
      /* try next */
    }
  }
  return null;
}

export function scoreCandidates(
  elements: PageElement[],
  original: Locator,
): HealCandidate[] {
  const candidates: HealCandidate[] = [];
  for (const el of elements) {
    if (el.locator.kind !== original.kind) continue; // same-kind only (ADR-010)
    const score = locatorSimilarity(original, el.locator);
    if (score > 0) candidates.push({ locator: el.locator, score });
  }
  return candidates.sort((a, b) => b.score - a.score);
}

function locatorSimilarity(a: Locator, b: Locator): number {
  if (a.kind === "role" && b.kind === "role") {
    if (a.role !== b.role) return 0;
    return jaccard(tokenize(a.name ?? ""), tokenize(b.name ?? ""));
  }
  if (a.kind === "label" && b.kind === "label") {
    return jaccard(tokenize(a.text), tokenize(b.text));
  }
  if (a.kind === "text" && b.kind === "text") {
    return jaccard(tokenize(a.text), tokenize(b.text));
  }
  if (a.kind === "testId" && b.kind === "testId") {
    return a.value === b.value ? 1 : jaccard(tokenize(a.value), tokenize(b.value));
  }
  return 0;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
