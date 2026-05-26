/**
 * Web UI — Express wrapper around `ai-test workflow`.
 *
 * Usage:
 *   npm run web-ui
 *   PORT=8080 npm run web-ui
 *
 * Routes:
 *   GET  /                      → single-page UI
 *   GET  /input-files/projects  → list inputs/projects/*.yaml
 *   GET  /input-files/auth      → list inputs/auth/*.yaml
 *   POST /run                   → spawn workflow, return { runId }
 *   POST /stop/:runId           → SIGTERM child process
 *   GET  /stream/:id            → SSE live log stream
 *   GET  /reports               → JSON list of HTML reports
 *   GET  /report-files/         → static HTML report files
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
  status: "running" | "done" | "error" | "stopped";
  exitCode: number | null;
  startedAt: Date;
  logBuffer: string[];
  subscribers: Set<ServerResponse>;
  child: ChildProcess;
}

const runs = new Map<string, RunRecord>();
const MAX_CONCURRENT   = 3;
const MAX_BUFFER_LINES = 2000;

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

function finishRun(run: RunRecord, exitCode: number, label: string) {
  run.status = exitCode === 0 ? "done" : label === "stopped" ? "stopped" : "error";
  run.exitCode = exitCode;
  for (const sub of run.subscribers) {
    sseWrite(sub, `[DONE] exitCode=${exitCode}`);
    sub.end();
  }
  run.subscribers.clear();
}

async function listYamlFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter(f => f.endsWith(".yaml") || f.endsWith(".yml")).sort();
  } catch { return []; }
}

// ─── Input schemas ────────────────────────────────────────────────────────────

const RunSchema = z.object({
  projectFile: z.string().min(1),                           // e.g. "inputs/projects/my-app.yaml"
  authFile:    z.string().optional(),                       // e.g. "inputs/auth/my-app.yaml"
  provider:    z.enum(["gemini","claude","codex","opencode-ollama","mock"]).default("gemini"),
  overwritePom: z.boolean().default(false),
});

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// ── GET / ─────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => res.send(PAGE_HTML));

// ── GET /input-files/projects ─────────────────────────────────────────────────
app.get("/input-files/projects", async (_req, res) => {
  const files = await listYamlFiles(path.join(rootDir, "inputs", "projects"));
  res.json(files);
});

// ── GET /input-files/auth ─────────────────────────────────────────────────────
app.get("/input-files/auth", async (_req, res) => {
  const files = await listYamlFiles(path.join(rootDir, "inputs", "auth"));
  res.json(files);
});

// ── POST /run ─────────────────────────────────────────────────────────────────
app.post("/run", (req, res) => {
  const parsed = RunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const input = parsed.data;

  // Validate project file exists
  const projectPath = path.resolve(rootDir, input.projectFile);
  if (!existsSync(projectPath)) {
    res.status(400).json({ error: `Project file not found: ${input.projectFile}` });
    return;
  }

  const running = [...runs.values()].filter(r => r.status === "running").length;
  if (running >= MAX_CONCURRENT) {
    res.status(429).json({ error: "Too many concurrent runs. Stop one first." });
    return;
  }

  const runId = generateRunId("W");
  const scriptPath = path.resolve(__dirname, "ai-test.ts");
  const argv = [
    "vite-node", scriptPath,
    "workflow",
    "--input", projectPath,
    "--skip-preflight",
  ];
  if (input.overwritePom) argv.push("--overwrite-pom");

  const env: NodeJS.ProcessEnv = { ...process.env };
  env.AI_TEST_DEFAULT_PROVIDER = input.provider;

  // If an auth file override is provided, inject via env so bootstrap can pick it up
  if (input.authFile) {
    env.SITE_AUTH_RECIPE = path.resolve(rootDir, input.authFile);
  }

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

  const onChunk = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) broadcast(record, line);
    }
  };
  child.stdout!.on("data", onChunk);
  child.stderr!.on("data", onChunk);

  child.on("exit", code => finishRun(record, code ?? -1, "exit"));
  child.on("error", err => {
    broadcast(record, `[ERROR] ${err.message}`);
    finishRun(record, -1, "exit");
  });

  res.status(202).json({ runId });
});

// ── POST /stop/:runId ─────────────────────────────────────────────────────────
app.post("/stop/:runId", (req, res) => {
  const run = runs.get(req.params.runId);
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }
  if (run.status !== "running") { res.status(400).json({ error: "Run is not active" }); return; }

  broadcast(run, "[STOPPED] Run cancelled by user.");
  run.child.kill("SIGTERM");
  setTimeout(() => { if (run.status === "running") run.child.kill("SIGKILL"); }, 5000);
  finishRun(run, -1, "stopped");
  res.json({ ok: true });
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
      --color-warn:#f59e0b;
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
    body{font-family:var(--font-family);background:var(--bg-app);color:var(--color-text);
      line-height:1.5;-webkit-font-smoothing:antialiased}

    /* Header */
    .hdr{background:rgba(255,255,255,.85);border-bottom:1px solid var(--border-color);
      position:sticky;top:0;z-index:100;backdrop-filter:blur(12px);padding:16px 32px}
    @media(prefers-color-scheme:dark){.hdr{background:rgba(17,24,39,.85)}}
    .hdr-inner{max-width:1280px;margin:0 auto;display:flex;align-items:center;gap:12px}
    .hdr h1{font-size:1.25rem;font-weight:700;letter-spacing:-.025em}
    .hdr .sub{font-size:.8rem;color:var(--color-text-muted);margin-top:2px}

    /* Main */
    .main{max-width:1280px;margin:0 auto;padding:32px;
      display:grid;grid-template-columns:420px 1fr;gap:24px;align-items:start}
    @media(max-width:860px){.main{grid-template-columns:1fr}}

    /* Panel */
    .panel{background:var(--bg-card);border:1px solid var(--border-color);
      border-radius:12px;padding:24px;box-shadow:var(--shadow-sm)}
    .panel-title{font-size:1rem;font-weight:700;margin-bottom:20px;
      padding-bottom:12px;border-bottom:1px solid var(--border-color);
      display:flex;justify-content:space-between;align-items:center}

    /* Form fields */
    .field{margin-bottom:16px}
    .field label{display:block;font-size:.78rem;font-weight:700;
      color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
    .field select,.field input[type=checkbox]{width:100%;padding:10px 12px;
      border:1px solid var(--border-color);border-radius:8px;
      font-family:var(--font-family);font-size:.9rem;
      background:var(--bg-card);color:var(--color-text);outline:none;
      transition:border-color .15s,box-shadow .15s;cursor:pointer}
    .field select:focus{border-color:var(--color-info);box-shadow:0 0 0 3px var(--color-info-bg)}
    .field select:disabled{opacity:.5;cursor:not-allowed}

    /* File select with refresh */
    .file-select-row{display:flex;gap:8px}
    .file-select-row select{flex:1}
    .btn-refresh{padding:0 10px;border:1px solid var(--border-color);border-radius:8px;
      background:var(--bg-card);color:var(--color-text-muted);cursor:pointer;
      font-size:1rem;transition:background .15s;flex-shrink:0}
    .btn-refresh:hover{background:var(--color-sk-bg)}

    /* Checkbox row */
    .check-row{display:flex;align-items:center;gap:8px;font-size:.875rem;font-weight:500;
      cursor:pointer}
    .check-row input{width:16px;height:16px;cursor:pointer;accent-color:var(--color-info)}

    /* Empty state hint */
    .select-hint{font-size:.75rem;color:var(--color-text-muted);margin-top:4px}

    /* Action buttons row */
    .btn-row{display:flex;gap:10px;margin-top:8px}
    .btn-run{flex:1;padding:12px;border-radius:8px;border:none;
      background:var(--color-info);color:#fff;font-family:var(--font-family);
      font-size:.925rem;font-weight:700;cursor:pointer;
      display:flex;align-items:center;justify-content:center;gap:8px;
      transition:opacity .2s,transform .1s}
    .btn-run:hover{opacity:.88}
    .btn-run:active{transform:scale(.98)}
    .btn-run:disabled{opacity:.45;cursor:not-allowed}
    .btn-stop{padding:12px 16px;border-radius:8px;border:1px solid var(--color-ko);
      background:rgba(239,68,68,.08);color:var(--color-ko);font-family:var(--font-family);
      font-size:.925rem;font-weight:700;cursor:pointer;
      display:none;align-items:center;justify-content:center;gap:6px;
      transition:background .15s}
    .btn-stop:hover{background:rgba(239,68,68,.16)}
    .btn-stop.visible{display:flex}

    /* Spinner */
    @keyframes spin{to{transform:rotate(360deg)}}
    .spinner{width:15px;height:15px;border:2px solid rgba(255,255,255,.35);
      border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;display:none}

    /* Right panel */
    .log-panel .panel-title{font-size:1rem}
    .status-dot{width:9px;height:9px;border-radius:50%;background:var(--border-color);
      transition:background .3s}
    .status-dot.running{background:var(--color-warn);animation:pulse 1s ease-in-out infinite}
    .status-dot.done{background:var(--color-ok)}
    .status-dot.error,.status-dot.stopped{background:var(--color-ko)}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

    #log-placeholder{color:#30363d;font-family:ui-monospace,monospace;font-size:.78rem;
      height:460px;display:flex;align-items:center;justify-content:center;
      border:1px solid #30363d;border-radius:8px;background:#0d1117}
    #log-output{background:#0d1117;color:#7ee787;
      font-family:'JetBrains Mono','Fira Code',ui-monospace,monospace;
      font-size:.78rem;line-height:1.7;padding:16px;border-radius:8px;
      height:460px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;
      border:1px solid #30363d;display:none}

    /* Report button */
    .btn-report{display:none;margin-top:14px;padding:10px 16px;border-radius:8px;
      border:1px solid var(--color-ok);background:rgba(16,185,129,.1);color:var(--color-ok);
      font-family:var(--font-family);font-size:.875rem;font-weight:700;
      text-decoration:none;align-items:center;gap:8px;transition:background .15s}
    .btn-report:hover{background:rgba(16,185,129,.2)}
    .btn-report.visible{display:inline-flex}

    /* Recent reports */
    .reports-section{margin-top:20px}
    .reports-title{font-size:.72rem;font-weight:700;text-transform:uppercase;
      letter-spacing:.06em;color:var(--color-text-muted);margin-bottom:8px}
    .report-list{display:flex;flex-direction:column;gap:5px}
    .report-item{display:flex;align-items:center;justify-content:space-between;
      padding:7px 12px;border:1px solid var(--border-color);border-radius:8px;
      font-size:.8rem}
    .report-item a{color:var(--color-info-text);text-decoration:none;font-weight:600}
    .report-item a:hover{text-decoration:underline}
    .report-id{color:var(--color-text-muted);font-family:monospace;font-size:.73rem}

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
    <!-- Config panel -->
    <div class="panel">
      <div class="panel-title">Configure Run</div>
      <form id="run-form">

        <div class="field">
          <label>Project Config File *</label>
          <div class="file-select-row">
            <select name="projectFile" id="project-select" required>
              <option value="">— select a project YAML —</option>
            </select>
            <button type="button" class="btn-refresh" onclick="loadFiles()" title="Refresh list">↺</button>
          </div>
          <div class="select-hint">Files in <code>inputs/projects/</code></div>
        </div>

        <div class="field">
          <label>Auth Recipe File <span style="font-weight:400;text-transform:none">(optional)</span></label>
          <div class="file-select-row">
            <select name="authFile" id="auth-select">
              <option value="">— none / use recipe in project YAML —</option>
            </select>
            <button type="button" class="btn-refresh" onclick="loadFiles()" title="Refresh list">↺</button>
          </div>
          <div class="select-hint">Files in <code>inputs/auth/</code></div>
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

        <div class="field">
          <label class="check-row">
            <input type="checkbox" name="overwritePom"/>
            Overwrite existing POM files
          </label>
        </div>

        <div class="btn-row">
          <button type="submit" class="btn-run" id="run-btn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            <span id="btn-label">Run Workflow</span>
            <div class="spinner" id="spinner"></div>
          </button>
          <button type="button" class="btn-stop" id="stop-btn" onclick="stopRun()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>
            Stop
          </button>
        </div>
      </form>
    </div>

    <!-- Log + report panel -->
    <div class="panel log-panel">
      <div class="panel-title">
        <span>Live Output</span>
        <div class="status-dot" id="status-dot"></div>
      </div>

      <div id="log-placeholder"><span>Waiting for run to start…</span></div>
      <pre id="log-output"></pre>

      <a class="btn-report" id="report-btn" href="#" target="_blank">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        View HTML Report →
      </a>

      <div class="reports-section">
        <div class="reports-title">Recent Reports</div>
        <div class="report-list" id="report-list">
          <div style="color:var(--color-text-muted);font-size:.8rem;padding:4px 0">No reports yet.</div>
        </div>
      </div>
    </div>
  </main>

  <footer class="ftr">
    Powered by <strong>ai-automation-framework</strong>
  </footer>

  <script>
    const form      = document.getElementById('run-form');
    const logEl     = document.getElementById('log-output');
    const logPH     = document.getElementById('log-placeholder');
    const reportBtn = document.getElementById('report-btn');
    const stopBtn   = document.getElementById('stop-btn');
    const spinner   = document.getElementById('spinner');
    const btnLabel  = document.getElementById('btn-label');
    const dot       = document.getElementById('status-dot');
    let es = null;
    let currentRunId = null;

    // ── Boot ──────────────────────────────────────────────────────────────────
    loadFiles();
    loadReports();

    async function loadFiles() {
      const [projects, auths] = await Promise.all([
        fetch('/input-files/projects').then(r => r.json()).catch(() => []),
        fetch('/input-files/auth').then(r => r.json()).catch(() => []),
      ]);
      populateSelect('project-select', projects, '— select a project YAML —');
      populateSelect('auth-select', auths, '— none / use recipe in project YAML —');
    }

    function populateSelect(id, files, placeholder) {
      const sel = document.getElementById(id);
      const prev = sel.value;
      sel.innerHTML = '<option value="">' + placeholder + '</option>';
      files.forEach(f => {
        const opt = document.createElement('option');
        opt.value = 'inputs/' + id.replace('project-select','projects').replace('auth-select','auth') + '/' + f;
        opt.textContent = f;
        if (opt.value === prev) opt.selected = true;
        sel.appendChild(opt);
      });
    }

    // ── Submit ────────────────────────────────────────────────────────────────
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const projectFile = form.projectFile.value;
      if (!projectFile) { alert('Please select a project config file.'); return; }

      setRunning(true);
      logEl.textContent = '';
      logPH.style.display = 'none';
      logEl.style.display = 'block';
      reportBtn.classList.remove('visible');
      dot.className = 'status-dot running';

      const body = {
        projectFile,
        authFile:    form.authFile.value || undefined,
        provider:    form.provider.value,
        overwritePom: form.overwritePom.checked,
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
        setRunning(false); dot.className = 'status-dot error'; return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        appendLog('[ERROR] ' + err.error);
        setRunning(false); dot.className = 'status-dot error'; return;
      }

      const { runId } = await res.json();
      currentRunId = runId;
      connectSSE(runId);
    });

    // ── SSE ───────────────────────────────────────────────────────────────────
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
          es.close(); return;
        }
        appendLog(line);
      };
      es.onerror = () => {
        appendLog('[Connection lost]');
        setRunning(false); dot.className = 'status-dot error'; es.close();
      };
    }

    // ── Stop ─────────────────────────────────────────────────────────────────
    async function stopRun() {
      if (!currentRunId) return;
      await fetch('/stop/' + currentRunId, { method: 'POST' }).catch(() => {});
      dot.className = 'status-dot stopped';
      setRunning(false);
      if (es) { es.close(); es = null; }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function appendLog(line) {
      logEl.textContent += line + '\\n';
      logEl.scrollTop = logEl.scrollHeight;
    }

    function setRunning(running) {
      form.querySelectorAll('select, button[type=submit]').forEach(el => el.disabled = running);
      spinner.style.display = running ? 'block' : 'none';
      btnLabel.textContent  = running ? 'Running…' : 'Run Workflow';
      stopBtn.classList.toggle('visible', running);
    }

    async function showReport(runId) {
      const reports = await fetch('/reports').then(r => r.json()).catch(() => []);
      const r = reports.find(r => r.runId === runId);
      if (r) { reportBtn.href = r.url; reportBtn.classList.add('visible'); }
    }

    async function loadReports() {
      const reports = await fetch('/reports').then(r => r.json()).catch(() => []);
      const list = document.getElementById('report-list');
      if (!reports.length) {
        list.innerHTML = '<div style="color:var(--color-text-muted);font-size:.8rem;padding:4px 0">No reports yet.</div>';
        return;
      }
      list.innerHTML = reports.slice(0, 8).map(r => \`
        <div class="report-item">
          <span class="report-id">\${r.runId}</span>
          <a href="\${r.url}" target="_blank">View →</a>
        </div>\`).join('');
    }
  </script>
</body>
</html>`;
