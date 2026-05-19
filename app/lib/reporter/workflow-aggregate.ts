import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunSummary } from "../validation";

export interface RoleRunBrief {
  roleName: string;
  runId: string;
  totals: RunSummary["totals"];
  htmlPath: string;
  junitPath?: string;
  testPlanPath?: string;
  defectsInserted: number;
  durationMs: number;
  prCommentUrl?: string | null;
}

export interface WorkflowAggregate {
  workflowId: string;
  project: string;
  baseUrl: string;
  startedAt: string;
  finishedAt: string;
  roles: RoleRunBrief[];
  totals: RunSummary["totals"];
}

export interface WriteAggregateOptions {
  reportsDir: string;
}

/**
 * Roll N per-role RunSummary briefs into one cross-role aggregate.
 * Output: reports/workflows/<workflowId>/index.html  + summary.json
 *
 * Charts (all server-rendered SVG / tables, self-contained):
 *   - Donut (overall pass/fail/skip across all roles)
 *   - Per-role bar (pass-rate per role)
 *   - Per-role table with links to the role's own HTML report
 */
export async function writeWorkflowAggregate(
  agg: WorkflowAggregate,
  opts: WriteAggregateOptions,
): Promise<{ summaryPath: string; htmlPath: string }> {
  const outDir = path.join(opts.reportsDir, "workflows", agg.workflowId);
  await mkdir(outDir, { recursive: true });
  const summaryPath = path.join(outDir, "summary.json");
  const htmlPath = path.join(outDir, "index.html");
  await writeFile(summaryPath, JSON.stringify(agg, null, 2));
  await writeFile(htmlPath, renderAggregateHtml(agg));
  return { summaryPath, htmlPath };
}

export function renderAggregateHtml(agg: WorkflowAggregate): string {
  const t = agg.totals;
  const donut = renderDonut(t);
  const rolesBar = renderRolesBar(agg.roles);
  const rolesTable = agg.roles
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.roleName)}</td>
      <td><a href="${escapeAttr(relative(r.htmlPath))}">${escapeHtml(r.runId)}</a></td>
      <td>${r.totals.total}</td>
      <td class="ok">${r.totals.passed}</td>
      <td class="ko">${r.totals.failed}</td>
      <td class="sk">${r.totals.skipped}</td>
      <td>${r.defectsInserted}</td>
      <td>${formatMs(r.durationMs)}</td>
      <td>
        ${r.junitPath ? `<a href="${escapeAttr(relative(r.junitPath))}">JUnit</a> ` : ""}
        ${r.testPlanPath ? `<a href="${escapeAttr(relative(r.testPlanPath))}">Plan</a> ` : ""}
        ${r.prCommentUrl ? `<a href="${escapeAttr(r.prCommentUrl)}" target="_blank" rel="noopener noreferrer">PR</a>` : ""}
      </td>
    </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Workflow ${escapeHtml(agg.workflowId)} — ai-test</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${CSS}</style>
</head>
<body>
  <header class="hdr">
    <h1>${escapeHtml(agg.project)}</h1>
    <div class="sub">
      ${escapeHtml(agg.workflowId)} · ${escapeHtml(agg.baseUrl)} ·
      ${escapeHtml(agg.startedAt)} → ${escapeHtml(agg.finishedAt)} ·
      ${agg.roles.length} role${agg.roles.length === 1 ? "" : "s"}
    </div>
  </header>

  <section class="kpi">
    ${donut}
    <div class="cards">
      ${kpiCard("Total", t.total, "")}
      ${kpiCard("Passed", t.passed, "ok")}
      ${kpiCard("Failed", t.failed, "ko")}
      ${kpiCard("Skipped", t.skipped, "sk")}
    </div>
  </section>

  <section class="panel">
    <h2>Per-role pass-rate</h2>
    ${rolesBar}
  </section>

  <section class="panel">
    <h2>Roles</h2>
    <table>
      <thead>
        <tr>
          <th>Role</th><th>Run id</th><th>Total</th><th>Passed</th>
          <th>Failed</th><th>Skipped</th><th>Defects</th><th>Duration</th><th>Links</th>
        </tr>
      </thead>
      <tbody>${rolesTable}</tbody>
    </table>
  </section>

  <footer class="ftr">Aggregated by ai-test workflow</footer>
</body>
</html>
`;
}

function renderDonut(t: { total: number; passed: number; failed: number; skipped: number }): string {
  const total = Math.max(1, t.total);
  const r = 56;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arc = (count: number, color: string) => {
    const len = (count / total) * c;
    const seg = `<circle cx="68" cy="68" r="${r}" fill="none" stroke="${color}" stroke-width="20" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 68 68)" />`;
    offset += len;
    return seg;
  };
  return `
    <svg width="136" height="136" viewBox="0 0 136 136" aria-label="overall pass/fail/skip">
      <circle cx="68" cy="68" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="20" />
      ${arc(t.passed, "#10b981")}
      ${arc(t.failed, "#ef4444")}
      ${arc(t.skipped, "#94a3b8")}
      <text x="68" y="62" text-anchor="middle" font-size="22" font-weight="700" fill="currentColor">${t.total}</text>
      <text x="68" y="84" text-anchor="middle" font-size="12" fill="#64748b">scenarios</text>
    </svg>`;
}

function renderRolesBar(roles: RoleRunBrief[]): string {
  if (roles.length === 0) return `<p class="muted">No roles ran.</p>`;
  const bars = roles
    .map((r) => {
      const pct = r.totals.total ? Math.round((r.totals.passed / r.totals.total) * 100) : 0;
      const cls = pct === 100 ? "ok" : r.totals.failed > 0 ? "ko" : "sk";
      return `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(r.roleName)}</div>
        <div class="bar-track">
          <div class="bar-fill ${cls}" style="width:${pct}%" aria-label="${pct}% pass"></div>
        </div>
        <div class="bar-pct">${pct}% (${r.totals.passed}/${r.totals.total})</div>
      </div>`;
    })
    .join("");
  return `<div class="bars">${bars}</div>`;
}

function kpiCard(label: string, n: number, cls: string): string {
  return `
    <div class="card ${cls}">
      <div class="n">${n}</div>
      <div class="l">${label}</div>
    </div>`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

const CSS = `
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a}
  .hdr{padding:16px 24px;background:#fff;border-bottom:1px solid #e2e8f0;position:sticky;top:0;z-index:10}
  .hdr h1{margin:0;font-size:1.25rem}
  .sub{color:#64748b;font-size:.85rem;margin-top:4px}
  .kpi{display:grid;grid-template-columns:auto 1fr;gap:24px;align-items:center;padding:16px 24px}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px}
  .card.ok{border-left:4px solid #10b981}
  .card.ko{border-left:4px solid #ef4444}
  .card.sk{border-left:4px solid #94a3b8}
  .card .n{font-size:2rem;font-weight:700}
  .card .l{color:#64748b;font-size:.85rem}
  .panel{margin:12px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px}
  .panel h2{margin:0 0 8px;font-size:1rem}
  .panel table{width:100%;border-collapse:collapse;font-size:.9rem}
  .panel th, .panel td{text-align:left;padding:6px 8px;border-bottom:1px dashed #e2e8f0}
  .panel td.ok{color:#166534}
  .panel td.ko{color:#991b1b}
  .panel td.sk{color:#475569}
  .bars{display:flex;flex-direction:column;gap:8px}
  .bar-row{display:grid;grid-template-columns:160px 1fr 130px;gap:12px;align-items:center}
  .bar-label{font-weight:600}
  .bar-track{height:14px;background:#e2e8f0;border-radius:7px;overflow:hidden}
  .bar-fill{height:100%;border-radius:7px}
  .bar-fill.ok{background:#10b981}
  .bar-fill.ko{background:#ef4444}
  .bar-fill.sk{background:#94a3b8}
  .bar-pct{color:#64748b;font-size:.85rem;text-align:right}
  .ftr{padding:16px 24px;color:#64748b;font-size:.8rem;border-top:1px solid #e2e8f0;background:#fff;margin-top:12px}
  .muted{color:#64748b}
  @media (prefers-color-scheme: dark){
    body{background:#020617;color:#e2e8f0}
    .hdr,.panel,.card,.ftr{background:#0f172a;border-color:#1e293b}
    .sub,.card .l,.bar-pct,.muted{color:#94a3b8}
    .panel td.ok{color:#bbf7d0}
    .panel td.ko{color:#fecaca}
    .panel td.sk{color:#cbd5e1}
    .bar-track{background:#1e293b}
  }
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
