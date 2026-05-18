import { describe, expect, it } from "vitest";
import { aggregateCoverage, computePageCoverage } from "./coverage-tracker";
import type { PageAnalysis, PageElement } from "../validation";

function el(name: string, locator: PageElement["locator"]): PageElement {
  return {
    id: name,
    tag: "button",
    locator,
    accessibleName: name,
    isRequired: false,
    isVisible: true,
    isDisabled: false,
    isSensitive: false,
  };
}

const analysis: PageAnalysis = {
  url: "https://x/home",
  finalUrl: "https://x/home",
  title: "Home",
  viewport: { width: 1280, height: 800 },
  capturedAt: "2026-05-17T10:00:00.000Z",
  screenshotPath: "p.png",
  elements: [
    el("Sign in", { kind: "role", role: "button", name: "Sign in" }),
    el("Search", { kind: "role", role: "searchbox", name: "Search" }),
    el("Help", { kind: "role", role: "link", name: "Help" }),
  ],
  forms: [],
  navigation: [],
  consoleErrors: [],
};

describe("computePageCoverage", () => {
  it("counts touched vs total", () => {
    const cov = computePageCoverage({
      pageUrl: analysis.url,
      pageHash: "h1",
      analysis,
      touched: [{ kind: "role", role: "button", name: "Sign in" }],
    });
    expect(cov.totalInteractive).toBe(3);
    expect(cov.touchedCount).toBe(1);
    expect(cov.ratio).toBeCloseTo(1 / 3);
    expect(cov.untouched.map((u) => u.label)).toEqual(["Search", "Help"]);
  });

  it("zero coverage when nothing touched", () => {
    const cov = computePageCoverage({
      pageUrl: analysis.url,
      pageHash: "h1",
      analysis,
      touched: [],
    });
    expect(cov.touchedCount).toBe(0);
  });
});

describe("aggregateCoverage", () => {
  it("rolls up across pages", () => {
    const p1 = computePageCoverage({
      pageUrl: "https://x/a",
      pageHash: "a",
      analysis,
      touched: [{ kind: "role", role: "button", name: "Sign in" }],
    });
    const p2 = computePageCoverage({
      pageUrl: "https://x/b",
      pageHash: "b",
      analysis,
      touched: [],
    });
    const run = aggregateCoverage("R-1", [p1, p2]);
    expect(run.totalInteractive).toBe(6);
    expect(run.totalTouched).toBe(1);
    expect(run.ratio).toBeCloseTo(1 / 6);
  });
});
