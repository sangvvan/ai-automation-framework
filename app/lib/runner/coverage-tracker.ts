import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, PageAnalysis } from "../validation";

export interface CoverageInput {
  pageUrl: string;
  pageHash: string;
  /** PageAnalysis to use as the universe of interactive elements. */
  analysis?: PageAnalysis;
  /** Locator(s) the scenario touched on this page. */
  touched: Locator[];
}

export interface PageCoverage {
  pageUrl: string;
  pageHash: string;
  totalInteractive: number;
  touchedCount: number;
  ratio: number;
  untouched: { kind: string; label: string }[];
}

export function computePageCoverage(input: CoverageInput): PageCoverage {
  const elements = input.analysis?.elements ?? [];
  const interactive = elements.filter((e) => e.isVisible && !e.isDisabled);
  const touchedKeys = new Set(input.touched.map(locatorKey));
  const untouched = interactive
    .filter((e) => !touchedKeys.has(locatorKey(e.locator)))
    .map((e) => ({
      kind: e.locator.kind,
      label:
        e.accessibleName ??
        (e.locator.kind === "text" || e.locator.kind === "label"
          ? e.locator.text
          : e.locator.kind === "testId"
            ? e.locator.value
            : ""),
    }));
  return {
    pageUrl: input.pageUrl,
    pageHash: input.pageHash,
    totalInteractive: interactive.length,
    touchedCount: interactive.length - untouched.length,
    ratio: interactive.length
      ? (interactive.length - untouched.length) / interactive.length
      : 0,
    untouched,
  };
}

function locatorKey(loc: Locator): string {
  switch (loc.kind) {
    case "role":
      return `role:${loc.role}:${loc.name ?? ""}`;
    case "label":
      return `label:${loc.text}`;
    case "text":
      return `text:${loc.text}`;
    case "testId":
      return `testId:${loc.value}`;
  }
}

export interface RunCoverage {
  runId: string;
  pages: PageCoverage[];
  totalInteractive: number;
  totalTouched: number;
  ratio: number;
}

export function aggregateCoverage(runId: string, pages: PageCoverage[]): RunCoverage {
  const totalInteractive = pages.reduce((s, p) => s + p.totalInteractive, 0);
  const totalTouched = pages.reduce((s, p) => s + p.touchedCount, 0);
  return {
    runId,
    pages,
    totalInteractive,
    totalTouched,
    ratio: totalInteractive ? totalTouched / totalInteractive : 0,
  };
}

export async function writeCoverageReport(
  runId: string,
  reportsDir: string,
  coverage: RunCoverage,
): Promise<string> {
  const outDir = path.join(reportsDir, "coverage");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${runId}.json`);
  await writeFile(outPath, JSON.stringify(coverage, null, 2));
  return outPath;
}
