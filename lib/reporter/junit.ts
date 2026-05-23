import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunSummary } from "../validation";

export interface SuiteGrouping {
  /** Suite id (uuid or temp slug) → display name. */
  names: Record<string, string>;
  /** Suite id → scenario ids belonging to that suite. */
  members: Record<string, string[]>;
}

export interface JunitOptions {
  reportsDir: string;
  /** Optional explicit suite grouping; otherwise a single "Default" suite. */
  suites?: SuiteGrouping;
}

export async function writeJunitReport(
  summary: RunSummary,
  opts: JunitOptions,
): Promise<string> {
  const outDir = path.join(opts.reportsDir, "junit");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${summary.runId}.xml`);
  await writeFile(outPath, renderJunit(summary, opts.suites));
  return outPath;
}

export function renderJunit(summary: RunSummary, grouping?: SuiteGrouping): string {
  const grouped = groupScenarios(summary, grouping);
  const totals = summary.totals;
  const time = secondsBetween(summary.startedAt, summary.finishedAt);
  const suiteXml = grouped.map((g) => renderSuite(g, summary)).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="${escapeAttr(summary.runId)}" tests="${totals.total}" failures="${totals.failed}" errors="0" skipped="${totals.skipped}" time="${time.toFixed(3)}">
${suiteXml}
</testsuites>
`;
}

interface Grouped {
  suiteName: string;
  scenarios: RunSummary["scenarios"];
}

function groupScenarios(summary: RunSummary, grouping?: SuiteGrouping): Grouped[] {
  if (!grouping) {
    return [{ suiteName: "Default", scenarios: summary.scenarios }];
  }
  const out: Grouped[] = [];
  const remaining = new Set(summary.scenarios.map((s) => s.scenario.id));
  for (const [suiteId, name] of Object.entries(grouping.names)) {
    const ids = grouping.members[suiteId] ?? [];
    const scenarios = summary.scenarios.filter((s) => {
      if (ids.includes(s.scenario.id)) {
        remaining.delete(s.scenario.id);
        return true;
      }
      return false;
    });
    if (scenarios.length > 0) out.push({ suiteName: name, scenarios });
  }
  // Orphans → Ad-hoc suite
  if (remaining.size > 0) {
    const scenarios = summary.scenarios.filter((s) => remaining.has(s.scenario.id));
    out.push({ suiteName: "Ad-hoc", scenarios });
  }
  return out;
}

function renderSuite(g: Grouped, summary: RunSummary): string {
  const tests = g.scenarios.length;
  const failures = g.scenarios.filter((s) => s.validation.status === "failed").length;
  const skipped = g.scenarios.filter((s) => s.result.status === "skipped").length;
  const totalMs = g.scenarios.reduce(
    (acc, s) => acc + secondsBetween(s.result.startedAt, s.result.finishedAt) * 1000,
    0,
  );

  const cases = g.scenarios.map((s) => renderCase(s, summary.runId)).join("\n");
  return `  <testsuite name="${escapeAttr(g.suiteName)}" tests="${tests}" failures="${failures}" errors="0" skipped="${skipped}" time="${(totalMs / 1000).toFixed(3)}">
${cases}
  </testsuite>`;
}

function renderCase(s: RunSummary["scenarios"][number], runId: string): string {
  const time = secondsBetween(s.result.startedAt, s.result.finishedAt).toFixed(3);
  const name = `${s.scenario.id} — ${s.scenario.title}`;
  const evidence = [
    s.result.screenshotPath ? `screenshot: ${s.result.screenshotPath}` : null,
    s.result.tracePath ? `trace: ${s.result.tracePath}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const systemOut = evidence
    ? `      <system-out><![CDATA[run=${runId}\n${evidence}]]></system-out>\n`
    : "";

  if (s.result.status === "skipped") {
    return `    <testcase classname="${escapeAttr(s.scenario.type)}" name="${escapeAttr(name)}" time="${time}">
      <skipped/>
${systemOut}    </testcase>`;
  }
  if (s.validation.status === "failed") {
    const reason = s.validation.failureReason ?? "failed";
    return `    <testcase classname="${escapeAttr(s.scenario.type)}" name="${escapeAttr(name)}" time="${time}">
      <failure message="${escapeAttr(reason.slice(0, 200))}" type="AssertionFailure"><![CDATA[
${reason}
${s.validation.suggestedDefect?.summary ?? ""}
]]></failure>
${systemOut}    </testcase>`;
  }
  return `    <testcase classname="${escapeAttr(s.scenario.type)}" name="${escapeAttr(name)}" time="${time}">
${systemOut}    </testcase>`;
}

function secondsBetween(a: string, b: string): number {
  return Math.max(0, (Date.parse(b) - Date.parse(a)) / 1000);
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
