import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunSummary } from "../validation";
import { maskRunSummary } from "./mask";

export interface HtmlReportOptions {
  reportsDir: string;
  maskKeys?: string[];
  previousSummary?: RunSummary;
}

export async function writeHtmlReport(
  summary: RunSummary,
  opts: HtmlReportOptions,
): Promise<string> {
  const masked = maskRunSummary(summary, { maskKeys: opts.maskKeys });
  const outDir = path.join(opts.reportsDir, "html", summary.runId);
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "index.html");
  await writeFile(outPath, renderHtml(masked, opts.previousSummary));
  return outPath;
}

export function renderHtml(summary: RunSummary, previous?: RunSummary): string {
  const t = summary.totals;
  const passPct = t.total ? Math.round((t.passed / t.total) * 100) : 0;
  const failPct = t.total ? Math.round((t.failed / t.total) * 100) : 0;
  const skipPct = t.total ? Math.round((t.skipped / t.total) * 100) : 0;

  const diff = previous ? computeDiff(summary, previous) : null;

  const rows = summary.scenarios
    .map((s, i) => renderRow(i, s))
    .join("\n");

  // Generate SVG Donut segments mathematically
  const totalVal = t.total || 1;
  const cCircumference = 2 * Math.PI * 40; // ~251.327
  const pLen = (t.passed / totalVal) * cCircumference;
  const fLen = (t.failed / totalVal) * cCircumference;
  const sLen = (t.skipped / totalVal) * cCircumference;

  let svgSegments = "";
  let currentOffset = 0;

  if (t.passed > 0) {
    svgSegments += `<circle class="donut-segment ok" cx="60" cy="60" r="40" fill="transparent" stroke="var(--color-ok)" stroke-width="12" stroke-dasharray="${pLen} ${cCircumference - pLen}" stroke-dashoffset="${currentOffset}" transform="rotate(-90 60 60)"></circle>`;
    currentOffset -= pLen;
  }
  if (t.failed > 0) {
    svgSegments += `<circle class="donut-segment ko" cx="60" cy="60" r="40" fill="transparent" stroke="var(--color-ko)" stroke-width="12" stroke-dasharray="${fLen} ${cCircumference - fLen}" stroke-dashoffset="${currentOffset}" transform="rotate(-90 60 60)"></circle>`;
    currentOffset -= fLen;
  }
  if (t.skipped > 0) {
    svgSegments += `<circle class="donut-segment sk" cx="60" cy="60" r="40" fill="transparent" stroke="var(--color-sk)" stroke-width="12" stroke-dasharray="${sLen} ${cCircumference - sLen}" stroke-dashoffset="${currentOffset}" transform="rotate(-90 60 60)"></circle>`;
  }

  // Draw empty state circle if total is 0
  if (t.total === 0) {
    svgSegments += `<circle cx="60" cy="60" r="40" fill="transparent" stroke="var(--border-color)" stroke-width="12"></circle>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>ai-test report — ${escapeHtml(summary.runId)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>${CSS}</style>
</head>
<body>
  <header class="hdr">
    <div class="hdr-content">
      <div class="hdr-main">
        <h1>${escapeHtml(summary.app ?? "System Test Run")}</h1>
        <div class="sub">
          <span class="run-id">${escapeHtml(summary.runId)}</span> ·
          <span class="pill pill-mode">${escapeHtml(summary.mode)}</span>
          <span class="pill pill-level">level: ${escapeHtml(summary.testLevel ?? "system")}</span>
        </div>
      </div>
      <div class="time-meta">
        <svg class="icon-clock" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z"/></svg>
        <span>${escapeHtml(summary.startedAt.split(".")[0].replace("T", " "))}</span>
      </div>
    </div>
  </header>

  <main class="dashboard">
    <div class="dashboard-grid">
      <!-- Donut Chart & KPIs Card -->
      <section class="panel chart-panel">
        <div class="panel-header">
          <h2>Execution Distribution</h2>
        </div>
        <div class="chart-kpi-layout">
          <div class="chart-wrapper">
            <svg class="donut-chart" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="40" fill="transparent" stroke="var(--border-color)" stroke-width="12" opacity="0.2"></circle>
              ${svgSegments}
            </svg>
            <div class="chart-center">
              <span class="chart-pct">${passPct}%</span>
              <span class="chart-lbl">Passed</span>
            </div>
          </div>
          <div class="kpi-grid">
            ${kpiCard("Total", t.total, "total")}
            ${kpiCard("Passed", t.passed, "ok", passPct)}
            ${kpiCard("Failed", t.failed, "ko", failPct)}
            ${kpiCard("Skipped", t.skipped, "sk", skipPct)}
          </div>
        </div>
      </section>

      <!-- ISTQB & Browser Compatibility -->
      <div class="side-panels">
        ${renderTechniqueCoverage(summary)}
        ${renderBrowserLocaleMatrix(summary)}
      </div>
    </div>

    ${diff ? renderDiff(diff) : ""}

    <!-- Scenario Execution Flow -->
    <section class="scenarios-section">
      <div class="section-header">
        <h2>Test Scenarios</h2>
      </div>
      <div class="list">
        ${rows || '<p class="muted">No scenarios in this run.</p>'}
      </div>
    </section>
  </main>

  <footer class="ftr">
    <div class="ftr-content">
      <span>Generated by <strong>ai-test framework</strong></span>
      <span class="muted">Node: ${escapeHtml(summary.environment.node ?? "Unknown")}</span>
    </div>
  </footer>
</body>
</html>
`;
}

function renderRow(
  i: number,
  s: RunSummary["scenarios"][number],
): string {
  const status = s.validation.status;
  const cls = status === "passed" ? "ok" : "ko";
  const steps = s.result.steps
    .map(
      (st) => {
        const stepStatus = st.status === "passed" ? "ok" : st.status === "failed" ? "ko" : "sk";
        return `
        <li class="step step-${st.status}">
          <span class="step-badge ${stepStatus}">${escapeHtml(st.status)}</span>
          <span class="step-i">#${st.index + 1}</span>
          <span class="step-d">${escapeHtml(s.scenario.steps[st.index]?.description ?? "")}</span>
          ${st.reason ? `<span class="step-r"><svg viewBox="0 0 24 24" class="icon-warning"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>${escapeHtml(st.reason)}</span>` : ""}
          ${st.screenshotPath ? `<a class="evi" target="_blank" href="${escapeAttr(relative(st.screenshotPath))}">
            <svg viewBox="0 0 24 24" class="icon-img"><path fill="currentColor" d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>Screenshot
          </a>` : ""}
        </li>`;
      },
    )
    .join("");

  const evidence = [
    s.result.screenshotPath ? `<a class="btn-evidence" target="_blank" href="${escapeAttr(relative(s.result.screenshotPath))}"><svg viewBox="0 0 24 24" class="icon-inline"><path fill="currentColor" d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>Final Screenshot</a>` : null,
    s.result.tracePath ? `<a class="btn-evidence" href="${escapeAttr(relative(s.result.tracePath))}"><svg viewBox="0 0 24 24" class="icon-inline"><path fill="currentColor" d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45-1-1-1s-1-.45-1-1V6H10v9c0 1.66 1.34 3 3 3s3-1.34 3-3V5c0-2.21-1.79-4-4-4S8 2.79 8 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>Trace File</a>` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return `
  <details class="scenario ${cls}" ${status === "failed" ? "open" : ""}>
    <summary>
      <div class="summary-left">
        <span class="status-pill ${cls}">${escapeHtml(status)}</span>
        <span class="title">${escapeHtml(s.scenario.title)}</span>
      </div>
      <div class="meta">
        <span class="meta-tag tag-type">${escapeHtml(s.scenario.type)}</span>
        <span class="meta-tag tag-prio">${escapeHtml(s.scenario.priority)}</span>
        <span class="meta-tag tag-origin">${escapeHtml(s.scenario.origin)}</span>
      </div>
    </summary>
    <div class="scenario-details">
      ${s.validation.failureReason ? `<blockquote class="why"><strong>Error Detail:</strong> ${escapeHtml(s.validation.failureReason)}</blockquote>` : ""}
      <ol class="steps">${steps}</ol>
      ${evidence ? `<div class="evidence">${evidence}</div>` : ""}
      ${s.validation.suggestedDefect ? renderDefect(s.validation.suggestedDefect) : ""}
    </div>
  </details>`;
}

function renderDefect(d: NonNullable<RunSummary["scenarios"][number]["validation"]["suggestedDefect"]>): string {
  return `
    <section class="defect">
      <h4>
        <svg viewBox="0 0 24 24" class="icon-inline"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"/></svg>
        Suggested defect (severity: <span class="sev-tag ${escapeHtml(d.severity)}">${escapeHtml(d.severity)}</span>)
      </h4>
      <p class="defect-summary">${escapeHtml(d.summary)}</p>
      <ul class="repro-list">${d.stepsToReproduce.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
    </section>`;
}

interface DiffOutcome {
  newFailures: string[];
  newlyPassing: string[];
}

function computeDiff(current: RunSummary, previous: RunSummary): DiffOutcome {
  const prev = new Map(previous.scenarios.map((s) => [s.scenario.id, s.validation.status]));
  const newFailures: string[] = [];
  const newlyPassing: string[] = [];
  for (const s of current.scenarios) {
    const prevStatus = prev.get(s.scenario.id);
    if (s.validation.status === "failed" && prevStatus !== "failed") {
      newFailures.push(s.scenario.id);
    }
    if (s.validation.status === "passed" && prevStatus === "failed") {
      newlyPassing.push(s.scenario.id);
    }
  }
  return { newFailures, newlyPassing };
}

function renderDiff(d: DiffOutcome): string {
  return `
  <section class="panel diff-panel">
    <div class="panel-header">
      <h2>Regression diff</h2>
      <span class="diff-counter">+${d.newFailures.length} new failures · +${d.newlyPassing.length} newly passing</span>
    </div>
    <div class="diff-body">
      ${d.newFailures.length ? `<details class="diff-cat ko" open><summary>New Failures (${d.newFailures.length})</summary><ul class="diff-list">${d.newFailures.map((id) => `<li><code>${escapeHtml(id)}</code></li>`).join("")}</ul></details>` : ""}
      ${d.newlyPassing.length ? `<details class="diff-cat ok"><summary>Newly Passing / Resolved (${d.newlyPassing.length})</summary><ul class="diff-list">${d.newlyPassing.map((id) => `<li><code>${escapeHtml(id)}</code></li>`).join("")}</ul></details>` : ""}
    </div>
  </section>`;
}

function kpiCard(label: string, n: number, cls: string, pct?: number): string {
  let icon = "";
  if (cls === "total") icon = `<path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>`;
  else if (cls === "ok") icon = `<path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>`;
  else if (cls === "ko") icon = `<path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>`;
  else icon = `<path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>`;

  return `
    <div class="kpi-card ${cls}">
      <div class="kpi-icon-wrap">
        <svg viewBox="0 0 24 24" class="kpi-icon">${icon}</svg>
      </div>
      <div class="kpi-info">
        <span class="kpi-num">${n}</span>
        <span class="kpi-label">${label}${pct !== undefined ? `<span class="kpi-pct"> · ${pct}%</span>` : ""}</span>
      </div>
    </div>`;
}

function renderTechniqueCoverage(summary: RunSummary): string {
  const coverage = summary.techniqueCoverage ?? [];
  if (coverage.length === 0) return "";
  
  const techRows = coverage
    .map((c) => {
      const pct = c.total ? Math.round((c.passed / c.total) * 100) : 0;
      return `
      <div class="tech-row">
        <div class="tech-info">
          <span class="tech-name"><code>${escapeHtml(c.technique)}</code></span>
          <span class="tech-ratio">${c.passed} / ${c.total} (${pct}%)</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill ok" style="width: ${pct}%"></div>
        </div>
      </div>`;
    })
    .join("");

  return `
  <section class="panel">
    <div class="panel-header">
      <h2>ISTQB Technique Coverage</h2>
    </div>
    <div class="tech-list">${techRows}</div>
  </section>`;
}

function renderBrowserLocaleMatrix(summary: RunSummary): string {
  const browsers = new Set<string>();
  const locales = new Set<string>();
  for (const s of summary.scenarios) {
    browsers.add(s.result.browser ?? "chromium");
    locales.add(s.result.locale ?? "—");
  }
  if (browsers.size <= 1 && locales.size <= 1) return "";

  const browserList = [...browsers].sort();
  const localeList = [...locales].sort();

  type Cell = { total: number; passed: number; failed: number };
  const matrix = new Map<string, Cell>();
  for (const s of summary.scenarios) {
    const key = `${s.result.browser ?? "chromium"}::${s.result.locale ?? "—"}`;
    const cell = matrix.get(key) ?? { total: 0, passed: 0, failed: 0 };
    cell.total++;
    if (s.validation.status === "passed") cell.passed++;
    else cell.failed++;
    matrix.set(key, cell);
  }

  const head =
    `<tr><th>Browser \\ Locale</th>` +
    localeList.map((l) => `<th>${escapeHtml(l)}</th>`).join("") +
    `</tr>`;
  const body = browserList
    .map((b) => {
      const cells = localeList
        .map((l) => {
          const c = matrix.get(`${b}::${l}`);
          if (!c) return `<td class="mx-empty">—</td>`;
          const pct = c.total ? Math.round((c.passed / c.total) * 100) : 0;
          const cls = c.failed === 0 ? "mx-ok" : c.passed === 0 ? "mx-ko" : "mx-mix";
          return `<td class="${cls}" title="${c.passed} passed / ${c.failed} failed"><strong>${c.passed}/${c.total}</strong> <small>(${pct}%)</small></td>`;
        })
        .join("");
      return `<tr><th>${escapeHtml(b)}</th>${cells}</tr>`;
    })
    .join("");

  return `
  <section class="panel">
    <div class="panel-header">
      <h2>Browser × Locale Compatibility</h2>
    </div>
    <div class="table-wrapper">
      <table class="mx-table">
        <thead>${head}</thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </section>`;
}

const CSS = `
  :root {
    --bg-app: #f8fafc;
    --bg-card: #ffffff;
    --color-text: #0f172a;
    --color-text-muted: #64748b;
    --color-ok: #10b981;
    --color-ok-bg: #dcfce7;
    --color-ok-text: #15803d;
    --color-ko: #f43f5e;
    --color-ko-bg: #ffe4e6;
    --color-ko-text: #be123c;
    --color-sk: #64748b;
    --color-sk-bg: #f1f5f9;
    --color-sk-text: #475569;
    --border-color: #e2e8f0;
    --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
    --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.04), 0 4px 6px -4px rgba(0, 0, 0, 0.04);
    --font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg-app: #030712;
      --bg-card: #0b0f19;
      --color-text: #f3f4f6;
      --color-text-muted: #9ca3af;
      --color-ok: #10b981;
      --color-ok-bg: rgba(16, 185, 129, 0.15);
      --color-ok-text: #34d399;
      --color-ko: #f43f5e;
      --color-ko-bg: rgba(244, 63, 94, 0.15);
      --color-ko-text: #fb7185;
      --color-sk: #6b7280;
      --color-sk-bg: rgba(107, 114, 128, 0.1);
      --color-sk-text: #9ca3af;
      --border-color: #1f2937;
    }
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font-family);
    background-color: var(--bg-app);
    color: var(--color-text);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  /* Header styles */
  .hdr {
    background-color: var(--bg-card);
    border-bottom: 1px solid var(--border-color);
    position: sticky;
    top: 0;
    z-index: 100;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    background-opacity: 0.95;
    padding: 16px 32px;
  }
  .hdr-content {
    max-width: 1280px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .hdr-main h1 {
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: -0.025em;
  }
  .hdr .sub {
    font-size: 0.875rem;
    color: var(--color-text-muted);
    margin-top: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .run-id {
    font-family: monospace;
    font-weight: 600;
  }
  .pill {
    font-size: 0.75rem;
    padding: 2px 8px;
    border-radius: 9999px;
    font-weight: 600;
    text-transform: uppercase;
    background-color: var(--color-sk-bg);
    color: var(--color-sk-text);
  }
  .pill-level {
    border: 1px solid var(--border-color);
  }
  .time-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.875rem;
    color: var(--color-text-muted);
    font-weight: 500;
  }
  .icon-clock {
    width: 16px;
    height: 16px;
  }

  /* Dashboard Layout */
  .dashboard {
    max-width: 1280px;
    margin: 0 auto;
    padding: 32px;
  }
  .dashboard-grid {
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 24px;
    align-items: start;
  }
  @media (max-width: 968px) {
    .dashboard-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Panel Common Styles */
  .panel {
    background-color: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 24px;
    box-shadow: var(--shadow-sm);
    margin-bottom: 24px;
    overflow: hidden;
  }
  .panel-header {
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 14px;
    margin-bottom: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .panel-header h2 {
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  /* Donut Chart and KPIs Layout */
  .chart-panel {
    min-height: 330px;
  }
  .chart-kpi-layout {
    display: flex;
    align-items: center;
    gap: 32px;
  }
  @media (max-width: 640px) {
    .chart-kpi-layout {
      flex-direction: column;
      align-items: center;
    }
  }
  .chart-wrapper {
    position: relative;
    width: 160px;
    height: 160px;
    flex-shrink: 0;
  }
  .donut-chart {
    width: 100%;
    height: 100%;
  }
  .donut-segment {
    transition: stroke-dasharray 0.3s ease;
  }
  .chart-center {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .chart-pct {
    font-size: 1.75rem;
    font-weight: 800;
    line-height: 1;
    color: var(--color-text);
  }
  .chart-lbl {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    margin-top: 2px;
  }

  .kpi-grid {
    flex-grow: 1;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    width: 100%;
  }
  .kpi-card {
    background-color: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }
  .kpi-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }
  .kpi-icon-wrap {
    width: 38px;
    height: 38px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .kpi-icon {
    width: 20px;
    height: 20px;
  }
  
  /* KPI specific colors */
  .kpi-card.total { border-left: 4px solid var(--color-sk); }
  .kpi-card.total .kpi-icon-wrap { background-color: var(--color-sk-bg); color: var(--color-sk-text); }
  
  .kpi-card.ok { border-left: 4px solid var(--color-ok); }
  .kpi-card.ok .kpi-icon-wrap { background-color: var(--color-ok-bg); color: var(--color-ok-text); }
  
  .kpi-card.ko { border-left: 4px solid var(--color-ko); }
  .kpi-card.ko .kpi-icon-wrap { background-color: var(--color-ko-bg); color: var(--color-ko-text); }
  
  .kpi-card.sk { border-left: 4px solid var(--color-sk); }
  .kpi-card.sk .kpi-icon-wrap { background-color: var(--color-sk-bg); color: var(--color-sk-text); }

  .kpi-info {
    display: flex;
    flex-direction: column;
  }
  .kpi-num {
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1.1;
  }
  .kpi-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted);
  }
  .kpi-pct {
    font-weight: 500;
  }

  /* Technique Coverage Styles */
  .side-panels {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .tech-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .tech-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .tech-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.825rem;
  }
  .tech-name {
    font-weight: 600;
  }
  .tech-name code {
    background-color: var(--color-sk-bg);
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 0.8rem;
  }
  .tech-ratio {
    font-weight: 600;
    color: var(--color-text-muted);
  }
  .progress-track {
    width: 100%;
    height: 6px;
    background-color: var(--color-sk-bg);
    border-radius: 99px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    border-radius: 99px;
  }
  .progress-fill.ok {
    background-color: var(--color-ok);
  }

  /* Matrix Compatibility */
  .table-wrapper {
    overflow-x: auto;
    width: 100%;
  }
  .mx-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    text-align: center;
  }
  .mx-table th, .mx-table td {
    padding: 8px 10px;
    border: 1px solid var(--border-color);
  }
  .mx-table th {
    background-color: var(--color-sk-bg);
    font-weight: 600;
  }
  .mx-table th:first-child, .mx-table td:first-child {
    text-align: left;
    font-weight: 600;
    background-color: var(--bg-card);
  }
  .mx-ok { background-color: var(--color-ok-bg); color: var(--color-ok-text); }
  .mx-ko { background-color: var(--color-ko-bg); color: var(--color-ko-text); }
  .mx-mix { background-color: #fef9c3; color: #854d0e; }
  .mx-empty { color: var(--color-text-muted); }

  /* Regression Diff Panel */
  .diff-panel {
    border-left: 4px solid var(--color-ko);
  }
  .diff-counter {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-ko-text);
  }
  .diff-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .diff-cat {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 10px 14px;
    background-color: var(--bg-app);
  }
  .diff-cat summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 0.875rem;
  }
  .diff-list {
    margin-top: 8px;
    padding-left: 20px;
    font-size: 0.825rem;
    color: var(--color-text-muted);
  }
  .diff-list code {
    background-color: var(--border-color);
    padding: 1px 4px;
    border-radius: 4px;
  }

  /* Scenarios Execution list */
  .scenarios-section {
    margin-top: 32px;
  }
  .section-header h2 {
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: -0.025em;
    margin-bottom: 16px;
  }
  .scenario {
    background-color: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    margin-bottom: 14px;
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }
  .scenario:hover {
    box-shadow: var(--shadow-md);
  }
  .scenario.ok { border-left: 4px solid var(--color-ok); }
  .scenario.ko { border-left: 4px solid var(--color-ko); }
  
  .scenario summary {
    cursor: pointer;
    padding: 18px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    user-select: none;
  }
  .scenario summary::-webkit-details-marker {
    display: none;
  }
  .summary-left {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .status-pill {
    font-size: 0.725rem;
    font-weight: 700;
    padding: 2px 10px;
    border-radius: 99px;
    text-transform: uppercase;
  }
  .status-pill.ok { background-color: var(--color-ok-bg); color: var(--color-ok-text); }
  .status-pill.ko { background-color: var(--color-ko-bg); color: var(--color-ko-text); }
  
  .scenario .title {
    font-weight: 600;
    font-size: 1rem;
    letter-spacing: -0.01em;
  }
  .scenario .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }
  .meta-tag {
    font-size: 0.725rem;
    font-weight: 500;
    padding: 2px 8px;
    border-radius: 4px;
    background-color: var(--color-sk-bg);
    color: var(--color-sk-text);
  }
  .tag-prio {
    font-weight: 600;
  }

  .scenario-details {
    padding: 0 24px 24px;
    border-top: 1px solid var(--border-color);
    background-color: var(--bg-app);
  }
  .why {
    background-color: var(--color-ko-bg);
    color: var(--color-ko-text);
    padding: 12px 16px;
    border-radius: 8px;
    margin: 16px 0;
    border-left: 4px solid var(--color-ko);
    font-size: 0.875rem;
  }
  
  .steps {
    list-style: none;
    margin-top: 16px;
    background-color: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 8px 0;
  }
  .step {
    display: flex;
    align-items: center;
    padding: 8px 16px;
    border-bottom: 1px dashed var(--border-color);
    font-size: 0.875rem;
  }
  .step:last-child {
    border-bottom: none;
  }
  .step-badge {
    font-size: 0.675rem;
    font-weight: 700;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 4px;
    width: 60px;
    text-align: center;
    flex-shrink: 0;
  }
  .step-badge.ok { background-color: var(--color-ok-bg); color: var(--color-ok-text); }
  .step-badge.ko { background-color: var(--color-ko-bg); color: var(--color-ko-text); }
  .step-badge.sk { background-color: var(--color-sk-bg); color: var(--color-sk-text); }
  
  .step-i {
    color: var(--color-text-muted);
    font-family: monospace;
    font-weight: 600;
    margin: 0 12px;
    width: 24px;
  }
  .step-d {
    flex-grow: 1;
    font-weight: 500;
  }
  .step-r {
    color: var(--color-ko-text);
    font-size: 0.8rem;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background-color: var(--color-ko-bg);
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 600;
  }
  .icon-warning {
    width: 14px;
    height: 14px;
  }
  .icon-img {
    width: 14px;
    height: 14px;
  }

  .evi {
    color: #0284c7;
    text-decoration: none;
    font-size: 0.8rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 12px;
    background-color: rgba(2, 132, 199, 0.08);
    padding: 2px 8px;
    border-radius: 4px;
    transition: background-color 0.2s ease;
  }
  .evi:hover {
    background-color: rgba(2, 132, 199, 0.15);
  }

  .evidence {
    margin-top: 16px;
    display: flex;
    gap: 8px;
  }
  .btn-evidence {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background-color: var(--bg-card);
    border: 1px solid var(--border-color);
    color: var(--color-text);
    padding: 6px 12px;
    border-radius: 6px;
    text-decoration: none;
    font-size: 0.8rem;
    font-weight: 600;
    box-shadow: var(--shadow-sm);
    transition: background-color 0.2s ease, transform 0.1s ease;
  }
  .btn-evidence:hover {
    background-color: var(--color-sk-bg);
  }
  .btn-evidence:active {
    transform: scale(0.98);
  }
  .icon-inline {
    width: 14px;
    height: 14px;
  }

  /* Defect box */
  .defect {
    margin-top: 16px;
    padding: 16px;
    border: 1px dashed var(--color-ko-text);
    border-radius: 8px;
    background-color: var(--color-ko-bg);
  }
  .defect h4 {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--color-ko-text);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sev-tag {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 4px;
  }
  .sev-tag.high { background-color: var(--color-ko); color: #fff; }
  .sev-tag.medium { background-color: #f59e0b; color: #fff; }
  .sev-tag.low { background-color: var(--color-sk); color: #fff; }
  
  .defect-summary {
    font-size: 0.875rem;
    font-weight: 600;
    margin: 8px 0;
    color: var(--color-text);
  }
  .repro-list {
    padding-left: 20px;
    font-size: 0.825rem;
    color: var(--color-text-muted);
  }

  /* Footer */
  .ftr {
    margin-top: 64px;
    border-top: 1px solid var(--border-color);
    background-color: var(--bg-card);
    padding: 24px 32px;
  }
  .ftr-content {
    max-width: 1280px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }
  .muted { color: var(--color-text-muted); }
`;

function escapeHtml(s: string | undefined | null): string {
  if (s === undefined || s === null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function relative(p: string): string {
  if (p.startsWith("/")) {
    const cwd = process.cwd();
    if (p.startsWith(cwd)) return path.relative(process.cwd(), p);
  }
  return p;
}

