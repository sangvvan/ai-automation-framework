/**
 * Web UI — thin Express wrapper around `ai-test quick`.
 *
 * Usage:
 *   npm run web-ui
 *   PORT=8080 npm run web-ui
 *
 * Routes:
 *   GET  /              → single-page form UI
 *   POST /run           → spawn workflow, return { runId }
 *   GET  /stream/:id    → SSE log stream
 *   GET  /reports       → JSON list of completed HTML reports
 *   GET  /report-files/ → static HTML report files
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import { spawn, type ChildProcess } from "node:child_process";
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { generateRunId } from "../lib/cli/run-id.js";
import type { ServerResponse } from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir   = path.resolve(__dirname, "..");

// ─── In-memory run state ──────────────────────────────────────────────────────

interface RunRecord {
  id: string;
  status: "running" | "done" | "error";
  exitCode: number | null;
  startedAt: Date;
  logBuffer: string[];
  subscribers: Set<ServerResponse>;
  child: ChildProcess;
}

const runs = new Map<string, RunRecord>();
const MAX_CONCURRENT  = 3;
const MAX_BUFFER_LINES = 2000;

// Prune finished runs older than 1 hour every 5 min
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, r] of runs) {
    if (r.status !== "running" && r.startedAt.getTime() < cutoff) runs.delete(id);
  }
}, 5 * 60 * 1000);

// ─── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function sseWrite(res: ServerResponse, line: string) {
  const escaped = line.replace(/\n/g, "\ndata: ");
  res.write(`data: ${escaped}\n\n`);
}

function broadcast(run: RunRecord, line: string) {
  const clean = stripAnsi(line);
  run.logBuffer.push(clean);
  if (run.logBuffer.length > MAX_BUFFER_LINES) run.logBuffer.shift();
  for (const sub of run.subscribers) sseWrite(sub, clean);
}

// ─── Input schema ─────────────────────────────────────────────────────────────

const RunSchema = z.object({
  url:       z.string().url(),
  username:  z.string().max(256).optional(),
  password:  z.string().max(1024).optional(),
  provider:  z.enum(["gemini", "claude", "codex", "opencode-ollama", "mock"]).default("gemini"),
  maxPages:  z.number().int().min(1).max(200).default(10),
  maxDepth:  z.number().int().min(0).max(10).default(3),
});

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// ── GET / ─────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => res.send(PAGE_HTML));

// ── POST /run ─────────────────────────────────────────────────────────────────
app.post("/run", (req, res) => {
  const parsed = RunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const input = parsed.data;

  const running = [...runs.values()].filter(r => r.status === "running").length;
  if (running >= MAX_CONCURRENT) {
    res.status(429).json({ error: "Too many concurrent runs. Try again shortly." });
    return;
  }

  const runId = generateRunId("W");
  const scriptPath = path.resolve(__dirname, "ai-test.ts");
  const argv = ["vite-node", scriptPath, "quick", "--url", input.url, "--skip-preflight"];
  if (input.username) argv.push("--username", input.username);

  const env: NodeJS.ProcessEnv = { ...process.env };
  env.AI_TEST_DEFAULT_PROVIDER = input.provider;
  env.WIZARD_MAX_PAGES = String(input.maxPages);
  env.WIZARD_MAX_DEPTH = String(input.maxDepth);
  if (input.username) env.SITE_USERNAME = input.username;
  if (input.password) env.SITE_PASSWORD = input.password;

  const child = spawn("npx", argv, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    cwd: rootDir,
  });

  const record: RunRecord = {
    id: runId, status: "running", exitCode: null,
    startedAt: new Date(), logBuffer: [], subscribers: new Set(), child,
  };
  runs.set(runId, record);

  const onLine = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line) broadcast(record, line);
    }
  };
  child.stdout!.on("data", onLine);
  child.stderr!.on("data", onLine);

  child.on("exit", code => {
    record.status = code === 0 ? "done" : "error";
    record.exitCode = code ?? -1;
    for (const sub of record.subscribers) {
      sseWrite(sub, `[DONE] exitCode=${record.exitCode}`);
      sub.end();
    }
    record.subscribers.clear();
  });

  res.status(202).json({ runId });
});

// ── GET /stream/:runId ────────────────────────────────────────────────────────
app.get("/stream/:runId", (req, res) => {
  const run = runs.get(req.params.runId);
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  for (const line of run.logBuffer) sseWrite(res, line);

  if (run.status !== "running") {
    sseWrite(res, `[DONE] exitCode=${run.exitCode ?? -1}`);
    res.end();
    return;
  }

  run.subscribers.add(res);
  req.on("close", () => run.subscribers.delete(res));
});

// ── GET /reports ──────────────────────────────────────────────────────────────
app.get("/reports", async (_req, res) => {
  const htmlDir = path.join(rootDir, "reports", "html");
  const results: { runId: string; url: string }[] = [];
  try {
    for (const runId of await readdir(htmlDir)) {
      if (existsSync(path.join(htmlDir, runId, "index.html"))) {
        results.push({ runId, url: `/report-files/${runId}/index.html` });
      }
    }
  } catch { /* reports dir may not exist yet */ }
  results.sort((a, b) => b.runId.localeCompare(a.runId));
  res.json(results);
});

// ── Static report files ───────────────────────────────────────────────────────
app.use("/report-files", express.static(path.join(rootDir, "reports", "html")));

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "127.0.0.1";
app.listen(PORT, HOST, () => {
  process.stdout.write(`\n  🤖  AI Test Web UI\n`);
  process.stdout.write(`  →  http://${HOST}:${PORT}\n`);
  process.stdout.write(`  Set HOST=0.0.0.0 to expose on network\n\n`);
});

// ─── Embedded single-page HTML ────────────────────────────────────────────────

const PAGE_HTML = /* html */`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>AI Test Web UI</title>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <style>
    :root {
      --bg-app:#f8fafc; --bg-card:#fff; --color-text:#0f172a;
      --color-text-muted:#64748b; --color-ok:#10b981; --color-ko:#ef4444;
      --color-info:#3b82f6; --color-info-bg:#e8f0fe; --color-info-text:#1a73e8;
      --color-sk-bg:#f1f5f9; --color-sk-text:#475569;
      --border-color:#e2e8f0; --shadow-sm:0 1px 2px rgba(0,0,0,.05);
      --shadow-md:0 4px 6px -1px rgba(0,0,0,.07);
      --font-family:'Plus Jakarta Sans',system-ui,sans-serif;
    }
    @media(prefers-color-scheme:dark){
      :root{
        --bg-app:#090d16; --bg-card:#111827; --color-text:#f3f4f6;
        --color-text-muted:#9ca3af; --color-info-bg:rgba(96,165,250,.1);
        --color-info-text:#60a5fa; --color-sk-bg:rgba(156,163,175,.1);
        --color-sk-text:#e5e7eb; --border-color:#1f2937;
      }
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:var(--font-family);background:var(--bg-app);color:var(--color-text);line-height:1.5;-webkit-font-smoothing:antialiased}

    /* Header */
    .hdr{background:rgba(255,255,255,.85);border-bottom:1px solid var(--border-color);
      position:sticky;top:0;z-index:100;backdrop-filter:blur(12px);padding:16px 32px}
    @media(prefers-color-scheme:dark){.hdr{background:rgba(17,24,39,.85)}}
    .hdr-inner{max-width:1280px;margin:0 auto;display:flex;align-items:center;gap:12px}
    .hdr h1{font-size:1.25rem;font-weight:700;letter-spacing:-.025em}
    .hdr .sub{font-size:.8rem;color:var(--color-text-muted);margin-top:2px}

    /* Main grid */
    .main{max-width:1280px;margin:0 auto;padding:32px;display:grid;
      grid-template-columns:5fr 7fr;gap:24px;align-items:start}
    @media(max-width:768px){.main{grid-template-columns:1fr}}

    /* Panel */
    .panel{background:var(--bg-card);border:1px solid var(--border-color);
      border-radius:12px;padding:24px;box-shadow:var(--shadow-sm)}
    .panel-title{font-size:1rem;font-weight:700;margin-bottom:20px;
      padding-bottom:12px;border-bottom:1px solid var(--border-color)}

    /* Form */
    .field{margin-bottom:16px}
    .field label{display:block;font-size:.8rem;font-weight:600;
      color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
    .field input,.field select{width:100%;padding:10px 12px;
      border:1px solid var(--border-color);border-radius:8px;
      font-family:var(--font-family);font-size:.9rem;
      background:var(--bg-card);color:var(--color-text);outline:none;
      transition:border-color .15s,box-shadow .15s}
    .field input:focus,.field select:focus{
      border-color:var(--color-info);box-shadow:0 0 0 3px var(--color-info-bg)}
    .field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}

    /* Provider badges */
    .provider-note{font-size:.75rem;color:var(--color-text-muted);margin-top:4px}

    /* Run button */
    .btn-run{width:100%;padding:12px;border-radius:8px;border:none;
      background:var(--color-info);color:#fff;font-family:var(--font-family);
      font-size:.95rem;font-weight:700;cursor:pointer;
      display:flex;align-items:center;justify-content:center;gap:10px;
      transition:opacity .2s,transform .1s;margin-top:8px}
    .btn-run:hover{opacity:.9}
    .btn-run:active{transform:scale(.98)}
    .btn-run:disabled{opacity:.5;cursor:not-allowed}

    /* Spinner */
    @keyframes spin{to{transform:rotate(360deg)}}
    .spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.3);
      border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;display:none}

    /* Terminal log */
    .log-panel .panel-title{display:flex;justify-content:space-between;align-items:center}
    .status-dot{width:8px;height:8px;border-radius:50%;background:var(--border-color)}
    .status-dot.running{background:#f59e0b;animation:pulse 1s ease-in-out infinite}
    .status-dot.done{background:var(--color-ok)}
    .status-dot.error{background:var(--color-ko)}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    #log-output{background:#0d1117;color:#7ee787;
      font-family:'JetBrains Mono','Fira Code',ui-monospace,monospace;
      font-size:.78rem;line-height:1.7;padding:16px;border-radius:8px;
      height:480px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;
      border:1px solid #30363d;margin-top:0}
    #log-placeholder{color:#30363d;font-family:ui-monospace,monospace;font-size:.78rem;
      padding:16px;height:480px;display:flex;align-items:center;justify-content:center;
      border:1px solid #30363d;border-radius:8px;background:#0d1117}

    /* Report button */
    .btn-report{display:none;margin-top:14px;padding:10px 16px;
      border-radius:8px;border:1px solid var(--color-ok);
      background:rgba(16,185,129,.1);color:var(--color-ok);
      font-family:var(--font-family);font-size:.875rem;font-weight:700;
      text-decoration:none;align-items:center;gap:8px;
      transition:background .15s}
    .btn-report:hover{background:rgba(16,185,129,.2)}

    /* Recent reports */
    .reports-section{margin-top:24px}
    .reports-title{font-size:.75rem;font-weight:700;text-transform:uppercase;
      letter-spacing:.05em;color:var(--color-text-muted);margin-bottom:10px}
    .report-list{display:flex;flex-direction:column;gap:6px}
    .report-item{display:flex;align-items:center;justify-content:space-between;
      padding:8px 12px;border:1px solid var(--border-color);border-radius:8px;
      background:var(--bg-card);font-size:.8rem}
    .report-item a{color:var(--color-info-text);text-decoration:none;font-weight:600}
    .report-item a:hover{text-decoration:underline}
    .report-id{color:var(--color-text-muted);font-family:monospace;font-size:.75rem}

    /* Footer */
    .ftr{margin-top:48px;border-top:1px solid var(--border-color);
      padding:20px 32px;font-size:.8rem;color:var(--color-text-muted);text-align:center}
  </style>
</head>
<body>
  <header class="hdr">
    <div class="hdr-inner">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="6" fill="#3b82f6"/>
        <path d="M7 12h2l2-4 2 8 2-4h2" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div>
        <h1>AI Test Web UI</h1>
        <div class="sub">Crawl → Generate TCs → Run → HTML Report</div>
      </div>
    </div>
  </header>

  <main class="main">
    <!-- Form panel -->
    <div class="panel">
      <div class="panel-title">Configure Run</div>
      <form id="run-form" autocomplete="off">

        <div class="field">
          <label>Web URL *</label>
          <input type="url" name="url" placeholder="https://myapp.com" required/>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Username</label>
            <input type="text" name="username" placeholder="Leave blank for anonymous" autocomplete="off"/>
          </div>
          <div class="field">
            <label>Password</label>
            <input type="password" name="password" placeholder="••••••••" autocomplete="new-password"/>
          </div>
        </div>

        <div class="field">
          <label>AI Provider</label>
          <select name="provider">
            <option value="gemini">⭐ Gemini 2.5 Pro — Google AI Pro</option>
            <option value="claude">Claude Sonnet 4.6 — Anthropic</option>
            <option value="codex">GPT-4o — OpenAI</option>
            <option value="opencode-ollama">Ollama (qwen2.5:14b) — Local / Offline</option>
            <option value="mock">Mock — No API key (dev/test)</option>
          </select>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Max Pages</label>
            <input type="number" name="maxPages" value="10" min="1" max="200"/>
          </div>
          <div class="field">
            <label>Max Depth</label>
            <input type="number" name="maxDepth" value="3" min="0" max="10"/>
          </div>
        </div>

        <button type="submit" class="btn-run" id="run-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <span id="btn-label">Run Full Workflow</span>
          <div class="spinner" id="spinner"></div>
        </button>
      </form>
    </div>

    <!-- Log + report panel -->
    <div class="panel log-panel">
      <div class="panel-title">
        <span>Live Output</span>
        <div class="status-dot" id="status-dot"></div>
      </div>

      <div id="log-placeholder">
        <span style="color:#484f58">Waiting for run to start…</span>
      </div>
      <pre id="log-output" style="display:none"></pre>

      <a class="btn-report" id="report-btn" href="#" target="_blank">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        View HTML Report →
      </a>

      <div class="reports-section">
        <div class="reports-title">Recent Reports</div>
        <div class="report-list" id="report-list">
          <div style="color:var(--color-text-muted);font-size:.8rem">No reports yet.</div>
        </div>
      </div>
    </div>
  </main>

  <footer class="ftr">
    Generated by <strong>ai-automation-framework</strong> &nbsp;·&nbsp; <a href="/reports" style="color:var(--color-info-text)">reports API</a>
  </footer>

  <script>
    const form     = document.getElementById('run-form');
    const logEl    = document.getElementById('log-output');
    const logPlaceholder = document.getElementById('log-placeholder');
    const reportBtn = document.getElementById('report-btn');
    const spinner  = document.getElementById('spinner');
    const btnLabel = document.getElementById('btn-label');
    const dot      = document.getElementById('status-dot');
    let es = null;

    // Load recent reports on mount
    loadReports();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setRunning(true);
      logEl.textContent = '';
      logPlaceholder.style.display = 'none';
      logEl.style.display = 'block';
      reportBtn.style.display = 'none';
      dot.className = 'status-dot running';

      const body = {
        url:      form.url.value,
        username: form.username.value || undefined,
        password: form.password.value || undefined,
        provider: form.provider.value,
        maxPages: Number(form.maxPages.value),
        maxDepth: Number(form.maxDepth.value),
      };

      let res;
      try {
        res = await fetch('/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (err) {
        appendLog('[ERROR] Cannot reach server: ' + err.message);
        setRunning(false);
        dot.className = 'status-dot error';
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        appendLog('[ERROR] ' + err.error);
        setRunning(false);
        dot.className = 'status-dot error';
        return;
      }

      const { runId } = await res.json();
      connectSSE(runId);
    });

    function connectSSE(runId) {
      if (es) es.close();
      es = new EventSource('/stream/' + runId);

      es.onmessage = (event) => {
        const line = event.data;
        if (line.startsWith('[DONE]')) {
          const code = parseInt(line.match(/exitCode=(-?\\d+)/)?.[1] ?? '-1', 10);
          setRunning(false);
          dot.className = 'status-dot ' + (code === 0 ? 'done' : 'error');
          if (code === 0) showReport(runId);
          loadReports();
          es.close();
          return;
        }
        appendLog(line);
      };

      es.onerror = () => {
        appendLog('[Connection lost]');
        setRunning(false);
        dot.className = 'status-dot error';
        es.close();
      };
    }

    function appendLog(line) {
      logEl.textContent += line + '\\n';
      logEl.scrollTop = logEl.scrollHeight;
    }

    function setRunning(running) {
      form.querySelectorAll('input, select, button').forEach(el => el.disabled = running);
      spinner.style.display = running ? 'block' : 'none';
      btnLabel.textContent = running ? 'Running…' : 'Run Full Workflow';
    }

    async function showReport(runId) {
      const reports = await fetch('/reports').then(r => r.json()).catch(() => []);
      const r = reports.find(r => r.runId === runId);
      if (r) {
        reportBtn.href = r.url;
        reportBtn.style.display = 'inline-flex';
      }
    }

    async function loadReports() {
      const reports = await fetch('/reports').then(r => r.json()).catch(() => []);
      const list = document.getElementById('report-list');
      if (!reports.length) {
        list.innerHTML = '<div style="color:var(--color-text-muted);font-size:.8rem">No reports yet.</div>';
        return;
      }
      list.innerHTML = reports.slice(0, 8).map(r => \`
        <div class="report-item">
          <span class="report-id">\${r.runId}</span>
          <a href="\${r.url}" target="_blank">View Report →</a>
        </div>\`).join('');
    }
  </script>
</body>
</html>`;
