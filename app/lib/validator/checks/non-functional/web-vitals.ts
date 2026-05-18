import type { Page } from "@playwright/test";
import type { ValidationCheck, WebVitals } from "../../../validation";

/**
 * Tiny inline web-vitals approximation that we register via
 * `page.addInitScript`. We don't bundle the official library to keep
 * cold start cheap; what we measure here is good enough for regression
 * gating and matches the names operators expect.
 */
const VITALS_INIT_SCRIPT = `
(function () {
  if (window.__aiTestVitals) return;
  const v = (window.__aiTestVitals = { lcpMs: null, cls: null, inpMs: null, ttfbMs: null });
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav && nav.responseStart) v.ttfbMs = nav.responseStart - nav.startTime;
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) v.lcpMs = last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    let cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) cls += e.value;
      }
      v.cls = cls;
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const max = entries.reduce((m, e) => Math.max(m, e.duration || 0), 0);
      if (max > 0) v.inpMs = max;
    }).observe({ type: 'event', buffered: true, durationThreshold: 40 });
  } catch (_e) { /* observer not supported */ }
})();
`;

export async function injectVitalsScript(page: Page): Promise<void> {
  await page.addInitScript(VITALS_INIT_SCRIPT);
}

export interface PerformanceThresholds {
  lcpMs?: number;
  cls?: number;
  inpMs?: number;
  ttfbMs?: number;
}

export async function captureVitals(
  page: Page,
  thresholds?: PerformanceThresholds,
): Promise<{ vitals: WebVitals; checks: ValidationCheck[] }> {
  let raw: Partial<WebVitals> | undefined;
  try {
    raw = (await page.evaluate(() => {
      return (window as unknown as { __aiTestVitals?: Partial<WebVitals> }).__aiTestVitals;
    })) ?? undefined;
  } catch {
    return {
      vitals: {
        lcpMs: null,
        cls: null,
        inpMs: null,
        ttfbMs: null,
        notMeasurable: true,
      },
      checks: [
        {
          name: "performance",
          status: "warn",
          detail: "Page closed before vitals could be read",
          category: "performance",
        },
      ],
    };
  }

  const vitals: WebVitals = {
    lcpMs: raw?.lcpMs ?? null,
    cls: raw?.cls ?? null,
    inpMs: raw?.inpMs ?? null,
    ttfbMs: raw?.ttfbMs ?? null,
    notMeasurable: !raw,
  };
  const checks: ValidationCheck[] = [];

  if (thresholds) {
    for (const [key, threshold] of Object.entries(thresholds) as [
      keyof PerformanceThresholds,
      number,
    ][]) {
      const observed = vitals[key as keyof WebVitals] as number | null;
      if (observed === null || observed === undefined) continue;
      const ratio = observed / threshold;
      const status: ValidationCheck["status"] =
        ratio > 2 ? "failed" : ratio > 1 ? "warn" : "passed";
      checks.push({
        name: `vitals:${key}`,
        status,
        detail: `${key}=${observed.toFixed(0)} threshold=${threshold}`,
        category: "performance",
      });
    }
  }

  if (vitals.notMeasurable) {
    checks.push({
      name: "performance",
      status: "warn",
      detail: "Vitals could not be measured (no PerformanceObserver hits)",
      category: "performance",
    });
  }

  return { vitals, checks };
}
