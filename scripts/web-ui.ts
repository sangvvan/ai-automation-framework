/**
 * Web UI — form-driven project init + workflow runner.
 *
 * Flow:
 *   User fills form → backend generates inputs/projects/<slug>.yaml
 *   + inputs/auth/<slug>.yaml (if credentials supplied) → spawns workflow
 *
 * Usage:
 *   npm run web-ui
 *   PORT=8080 HOST=0.0.0.0 npm run web-ui
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as stringifyYaml } from "yaml";
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
  for (const [id, r] of runs)
    if (r.status !== "running" && r.startedAt.getTime() < cutoff) runs.delete(id);
}, 5 * 60 * 1000);

// ─── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function sseWrite(res: ServerResponse, line: string) {
  res.write(`data: ${line.replace(/\n/g, "\ndata: ")}\n\n`);
}

function broadcast(run: RunRecord, line: string) {
  const clean = stripAnsi(line);
  run.logBuffer.push(clean);
  if (run.logBuffer.length > MAX_BUFFER_LINES) run.logBuffer.shift();
  for (const sub of run.subscribers) sseWrite(sub, clean);
}

function finishRun(run: RunRecord, exitCode: number) {
  run.status = exitCode === 0 ? "done" : run.status === "stopped" ? "stopped" : "error";
  run.exitCode = exitCode;
  for (const sub of run.subscribers) { sseWrite(sub, `[DONE] exitCode=${exitCode}`); sub.end(); }
  run.subscribers.clear();
}

function safeSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
}

// ─── YAML file generators ─────────────────────────────────────────────────────

interface ProjectInit {
  projectName: string;
  baseUrl: string;
  loginUrl?: string;
  roleName: string;
  username?: string;
  password?: string;
  maxPages: number;
  maxDepth: number;
}

async function createProjectFiles(init: ProjectInit): Promise<{
  projectFile: string;
  authFile?: string;
}> {
  const slug = safeSlug(init.projectName);

  let authFile: string | undefined;

  // Create auth recipe if credentials provided
  if (init.username && init.password) {
    const loginUrl = init.loginUrl || init.baseUrl;
    const recipe = {
      id: slug,
      loginUrl,
      fields: {
        username: {
          locator: { kind: "css", css: "input[type='email'],input[name='username'],input[name='email'],input[id*='email'],input[id*='user']" },
          value: "${SITE_USERNAME}",
        },
        password: {
          locator: { kind: "css", css: "input[type='password']" },
          value: "${SITE_PASSWORD}",
        },
        extras: [],
      },
      submit: {
        locator: { kind: "css", css: "button[type='submit'],input[type='submit'],button:has-text('Login'),button:has-text('Sign in')" },
      },
      postLogin: { waitFor: [] },
      expectsCaptcha: false,
    };

    authFile = path.join("inputs", "auth", `${slug}.yaml`);
    await mkdir(path.join(rootDir, "inputs", "auth"), { recursive: true });
    await writeFile(path.join(rootDir, authFile), stringifyYaml(recipe), "utf8");
  }

  // Create project workflow YAML
  const roles = authFile
    ? [
        { name: "anonymous" },
        { name: init.roleName || "authenticated", authRecipe: authFile },
      ]
    : [{ name: "anonymous" }];

  const projectYaml = {
    project: init.projectName,
    baseUrl: init.baseUrl,
    roles,
    crawl: {
      maxPages: init.maxPages,
      maxDepth: init.maxDepth,
      maxConcurrency: 2,
      perHostQps: 2,
      includeSubdomains: false,
      ignoreRobots: false,
    },
    generation: {
      outputDir: "tests/generated",
      maxScenariosPerPage: 14,
      fallbackSmoke: true,
    },
    run: {
      testLevel: "system",
      browsers: ["chromium"],
      locales: [],
      nonFunctional: { a11y: true, a11yFailOn: [], vitals: true, securityHeaders: true },
      junit: true,
      testPlan: true,
      persistDefects: true,
      prComment: false,
      suiteTag: slug,
    },
  };

  const projectFile = path.join("inputs", "projects", `${slug}.yaml`);
  await mkdir(path.join(rootDir, "inputs", "projects"), { recursive: true });
  await writeFile(path.join(rootDir, projectFile), stringifyYaml(projectYaml), "utf8");

  return { projectFile, authFile };
}

// ─── Input schema ─────────────────────────────────────────────────────────────

const RunSchema = z.object({
  projectName: z.string().min(1).max(80),
  baseUrl:     z.string().url(),
  loginUrl:    z.string().url().optional().or(z.literal("")),
  roleName:    z.string().max(40).default("authenticated"),
  username:    z.string().max(256).optional(),
  password:    z.string().max(1024).optional(),
  provider:    z.enum(["gemini","claude","codex","opencode-ollama","mock"]).default("gemini"),
  maxPages:    z.number().int().min(1).max(200).default(10),
  maxDepth:    z.number().int().min(0).max(10).default(3),
});

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// ── GET / ─────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => res.send(PAGE_HTML));

// ── POST /run ─────────────────────────────────────────────────────────────────
app.post("/run", async (req, res) => {
  const parsed = RunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const input = parsed.data;

  const running = [...runs.values()].filter(r => r.status === "running").length;
  if (running >= MAX_CONCURRENT) {
    res.status(429).json({ error: "Too many concurrent runs. Stop one first." });
    return;
  }

  // Generate YAML files before spawning
  let projectFile: string;
  let authFile: string | undefined;
  try {
    ({ projectFile, authFile } = await createProjectFiles({
      projectName: input.projectName,
      baseUrl:     input.baseUrl,
      loginUrl:    input.loginUrl || undefined,
      roleName:    input.roleName,
      username:    input.username,
      password:    input.password,
      maxPages:    input.maxPages,
      maxDepth:    input.maxDepth,
    }));
  } catch (err) {
    res.status(500).json({ error: `Failed to create config files: ${(err as Error).message}` });
    return;
  }

  const runId = generateRunId("W");
  const scriptPath = path.resolve(__dirname, "ai-test.ts");
  const argv = ["vite-node", scriptPath, "workflow", "--input",
    path.resolve(rootDir, projectFile), "--skip-preflight"];

  const env: NodeJS.ProcessEnv = { ...process.env };
  env.AI_TEST_DEFAULT_PROVIDER = input.provider;
  if (input.username) env.SITE_USERNAME = input.username;
  if (input.password) env.SITE_PASSWORD = input.password;

  const child = spawn("npx", argv, {
    env, stdio: ["ignore", "pipe", "pipe"], shell: false, cwd: rootDir,
  });

  const record: RunRecord = {
    id: runId, status: "running", exitCode: null,
    startedAt: new Date(), logBuffer: [], subscribers: new Set(), child,
  };
  runs.set(runId, record);

  const fileInfo = [
    `[INIT] Project file: ${projectFile}`,
    authFile ? `[INIT] Auth recipe:   ${authFile}` : "[INIT] Auth: anonymous (no credentials)",
  ].join("\n");
  broadcast(record, fileInfo);

  const onChunk = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n"))
      if (line.trim()) broadcast(record, line);
  };
  child.stdout!.on("data", onChunk);
  child.stderr!.on("data", onChunk);
  child.on("exit", code => finishRun(record, code ?? -1));
  child.on("error", err => { broadcast(record, `[ERROR] ${err.message}`); finishRun(record, -1); });

  res.status(202).json({ runId, projectFile, authFile });
});

// ── POST /stop/:runId ─────────────────────────────────────────────────────────
app.post("/stop/:runId", (req, res) => {
  const run = runs.get(req.params.runId);
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }
  if (run.status !== "running") { res.status(400).json({ error: "Run is not active" }); return; }
  run.status = "stopped";
  broadcast(run, "[STOPPED] Run cancelled by user.");
  run.child.kill("SIGTERM");
  setTimeout(() => { if (run.status === "stopped") run.child.kill("SIGKILL"); }, 5000);
  finishRun(run, -1);
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
    res.end(); return;
  }
  run.subscribers.add(res);
  req.on("close", () => run.subscribers.delete(res));
});

// ── GET /reports ──────────────────────────────────────────────────────────────
app.get("/reports", async (_req, res) => {
  const htmlDir = path.join(rootDir, "reports", "html");
  const results: { runId: string; url: string }[] = [];
  try {
    for (const runId of await readdir(htmlDir))
      if (existsSync(path.join(htmlDir, runId, "index.html")))
        results.push({ runId, url: `/report-files/${runId}/index.html` });
  } catch { /* not yet */ }
  results.sort((a, b) => b.runId.localeCompare(a.runId));
  res.json(results);
});

app.use("/report-files", express.static(path.join(rootDir, "reports", "html")));

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "127.0.0.1";
app.listen(PORT, HOST, () => {
  process.stdout.write(`\n  🤖  AI Test Web UI\n  →  http://${HOST}:${PORT}\n\n`);
});

// ─── Page HTML ────────────────────────────────────────────────────────────────

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
      --bg-app:#f8fafc;--bg-card:#fff;--color-text:#0f172a;
      --color-muted:#64748b;--color-ok:#10b981;--color-ko:#ef4444;
      --color-warn:#f59e0b;--color-info:#3b82f6;
      --color-info-bg:#e8f0fe;--color-info-text:#1a73e8;
      --color-sk-bg:#f1f5f9;--border:#e2e8f0;
      --shadow-sm:0 1px 2px rgba(0,0,0,.05);
      --font:'Plus Jakarta Sans',system-ui,sans-serif;
    }
    @media(prefers-color-scheme:dark){
      :root{--bg-app:#090d16;--bg-card:#111827;--color-text:#f3f4f6;
        --color-muted:#9ca3af;--color-info-bg:rgba(96,165,250,.1);
        --color-info-text:#60a5fa;--color-sk-bg:rgba(156,163,175,.1);--border:#1f2937;}
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:var(--font);background:var(--bg-app);color:var(--color-text);
      line-height:1.5;-webkit-font-smoothing:antialiased}

    .hdr{background:rgba(255,255,255,.85);border-bottom:1px solid var(--border);
      position:sticky;top:0;z-index:100;backdrop-filter:blur(12px);padding:14px 32px}
    @media(prefers-color-scheme:dark){.hdr{background:rgba(17,24,39,.85)}}
    .hdr-inner{max-width:1280px;margin:0 auto;display:flex;align-items:center;gap:12px}
    .hdr h1{font-size:1.2rem;font-weight:700;letter-spacing:-.02em}
    .hdr .sub{font-size:.78rem;color:var(--color-muted);margin-top:1px}

    .main{max-width:1280px;margin:0 auto;padding:28px 32px;
      display:grid;grid-template-columns:400px 1fr;gap:24px;align-items:start}
    @media(max-width:860px){.main{grid-template-columns:1fr;padding:20px 16px}}

    .panel{background:var(--bg-card);border:1px solid var(--border);
      border-radius:12px;padding:22px;box-shadow:var(--shadow-sm)}
    .panel-title{font-size:.95rem;font-weight:700;margin-bottom:18px;
      padding-bottom:12px;border-bottom:1px solid var(--border);
      display:flex;justify-content:space-between;align-items:center}

    /* Section headers inside form */
    .section-label{font-size:.7rem;font-weight:700;text-transform:uppercase;
      letter-spacing:.07em;color:var(--color-muted);margin:18px 0 10px;
      display:flex;align-items:center;gap:8px}
    .section-label::after{content:'';flex:1;height:1px;background:var(--border)}

    .field{margin-bottom:12px}
    .field label{display:block;font-size:.77rem;font-weight:600;
      color:var(--color-muted);margin-bottom:5px}
    .field input,.field select{width:100%;padding:9px 11px;
      border:1px solid var(--border);border-radius:7px;
      font-family:var(--font);font-size:.875rem;
      background:var(--bg-card);color:var(--color-text);outline:none;
      transition:border-color .15s,box-shadow .15s}
    .field input:focus,.field select:focus{
      border-color:var(--color-info);box-shadow:0 0 0 3px var(--color-info-bg)}
    .field input::placeholder{color:var(--color-muted);opacity:.7}
    .field .hint{font-size:.72rem;color:var(--color-muted);margin-top:4px}
    .field-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}

    .btn-row{display:flex;gap:10px;margin-top:16px}
    .btn-run{flex:1;padding:11px;border-radius:8px;border:none;
      background:var(--color-info);color:#fff;font-family:var(--font);
      font-size:.9rem;font-weight:700;cursor:pointer;
      display:flex;align-items:center;justify-content:center;gap:8px;
      transition:opacity .2s}
    .btn-run:hover{opacity:.88}
    .btn-run:disabled{opacity:.45;cursor:not-allowed}
    .btn-stop{padding:11px 14px;border-radius:8px;
      border:1px solid var(--color-ko);background:rgba(239,68,68,.08);
      color:var(--color-ko);font-family:var(--font);font-size:.9rem;font-weight:700;
      cursor:pointer;display:none;align-items:center;gap:6px;transition:background .15s}
    .btn-stop:hover{background:rgba(239,68,68,.16)}
    .btn-stop.show{display:flex}

    @keyframes spin{to{transform:rotate(360deg)}}
    .spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,.3);
      border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;display:none}

    /* Files generated notice */
    .files-notice{margin-top:12px;padding:10px 12px;border-radius:7px;
      background:var(--color-sk-bg);border:1px solid var(--border);
      font-size:.78rem;color:var(--color-muted);display:none}
    .files-notice code{font-family:monospace;color:var(--color-info-text)}

    /* Right panel */
    .log-panel .panel-title{font-size:.95rem}
    .dot{width:9px;height:9px;border-radius:50%;background:var(--border);transition:background .3s}
    .dot.running{background:var(--color-warn);animation:pulse 1s ease-in-out infinite}
    .dot.done{background:var(--color-ok)}
    .dot.error,.dot.stopped{background:var(--color-ko)}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

    #log-ph{color:#484f58;font-family:ui-monospace,monospace;font-size:.78rem;
      height:440px;display:flex;align-items:center;justify-content:center;
      border:1px solid #30363d;border-radius:8px;background:#0d1117}
    #log{background:#0d1117;color:#7ee787;
      font-family:'JetBrains Mono','Fira Code',ui-monospace,monospace;
      font-size:.77rem;line-height:1.7;padding:14px;border-radius:8px;
      height:440px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;
      border:1px solid #30363d;display:none}

    .btn-report{display:none;margin-top:12px;padding:9px 14px;border-radius:8px;
      border:1px solid var(--color-ok);background:rgba(16,185,129,.1);
      color:var(--color-ok);font-family:var(--font);font-size:.85rem;font-weight:700;
      text-decoration:none;align-items:center;gap:7px;transition:background .15s}
    .btn-report:hover{background:rgba(16,185,129,.2)}
    .btn-report.show{display:inline-flex}

    .recent{margin-top:18px}
    .recent-title{font-size:.7rem;font-weight:700;text-transform:uppercase;
      letter-spacing:.07em;color:var(--color-muted);margin-bottom:8px}
    .ri{display:flex;align-items:center;justify-content:space-between;
      padding:6px 10px;border:1px solid var(--border);border-radius:7px;
      font-size:.78rem;margin-bottom:5px}
    .ri a{color:var(--color-info-text);text-decoration:none;font-weight:600}
    .ri a:hover{text-decoration:underline}
    .ri-id{font-family:monospace;font-size:.72rem;color:var(--color-muted)}

    .ftr{margin-top:40px;border-top:1px solid var(--border);
      padding:16px 32px;font-size:.78rem;color:var(--color-muted);text-align:center}
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
      <div class="sub">Init project → Generate test cases → Run → Report</div>
    </div>
  </div>
</header>

<main class="main">
  <!-- Left: form -->
  <div class="panel">
    <div class="panel-title">New Test Run</div>
    <form id="form" autocomplete="off">

      <div class="section-label">Project</div>

      <div class="field">
        <label>Project Name *</label>
        <input name="projectName" type="text" placeholder="e.g. My App" required/>
        <div class="hint">Used as folder name — e.g. <code>inputs/projects/my-app.yaml</code></div>
      </div>

      <div class="field">
        <label>Base URL *</label>
        <input name="baseUrl" type="url" placeholder="https://myapp.com" required/>
      </div>

      <div class="section-label">Authentication <span style="font-weight:400;text-transform:none;font-size:.8rem">(optional)</span></div>

      <div class="field">
        <label>Login URL</label>
        <input name="loginUrl" type="url" placeholder="https://myapp.com/login  (blank = auto-detect)"/>
        <div class="hint">Leave blank if login is on the base URL or site has no auth</div>
      </div>

      <div class="field">
        <label>Role Name</label>
        <input name="roleName" type="text" placeholder="authenticated" value="authenticated"/>
      </div>

      <div class="field-row">
        <div class="field">
          <label>Username</label>
          <input name="username" type="text" placeholder="admin@example.com" autocomplete="off"/>
        </div>
        <div class="field">
          <label>Password</label>
          <input name="password" type="password" placeholder="••••••••" autocomplete="new-password"/>
        </div>
      </div>

      <div class="section-label">Settings</div>

      <div class="field-row">
        <div class="field">
          <label>AI Provider</label>
          <select name="provider">
            <option value="gemini">⭐ Gemini 2.5 Pro</option>
            <option value="claude">Claude Sonnet</option>
            <option value="codex">GPT-4o</option>
            <option value="opencode-ollama">Ollama (local)</option>
            <option value="mock">Mock (no API)</option>
          </select>
        </div>
        <div class="field">
          <label>Max Pages</label>
          <input name="maxPages" type="number" value="10" min="1" max="200"/>
        </div>
      </div>

      <div class="btn-row">
        <button type="submit" class="btn-run" id="run-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <span id="btn-label">Run Workflow</span>
          <div class="spinner" id="spinner"></div>
        </button>
        <button type="button" class="btn-stop" id="stop-btn" onclick="stopRun()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>
          Stop
        </button>
      </div>

      <div class="files-notice" id="files-notice">
        <strong>Generated config files:</strong><br/>
        <span id="files-list"></span>
      </div>
    </form>
  </div>

  <!-- Right: log + reports -->
  <div class="panel log-panel">
    <div class="panel-title">
      Live Output
      <div class="dot" id="dot"></div>
    </div>

    <div id="log-ph"><span>Waiting for run to start…</span></div>
    <pre id="log"></pre>

    <a class="btn-report" id="report-btn" href="#" target="_blank">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
      View HTML Report →
    </a>

    <div class="recent">
      <div class="recent-title">Recent Reports</div>
      <div id="report-list"><div style="color:var(--color-muted);font-size:.78rem">No reports yet.</div></div>
    </div>
  </div>
</main>

<footer class="ftr">Powered by <strong>ai-automation-framework</strong></footer>

<script>
  const form      = document.getElementById('form');
  const logEl     = document.getElementById('log');
  const logPH     = document.getElementById('log-ph');
  const reportBtn = document.getElementById('report-btn');
  const stopBtn   = document.getElementById('stop-btn');
  const spinner   = document.getElementById('spinner');
  const btnLabel  = document.getElementById('btn-label');
  const dot       = document.getElementById('dot');
  const notice    = document.getElementById('files-notice');
  const filesList = document.getElementById('files-list');
  let es = null, currentRunId = null;

  loadReports();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setRunning(true);
    logEl.textContent = '';
    logPH.style.display = 'none';
    logEl.style.display = 'block';
    reportBtn.classList.remove('show');
    notice.style.display = 'none';
    dot.className = 'dot running';

    const body = {
      projectName: form.projectName.value.trim(),
      baseUrl:     form.baseUrl.value.trim(),
      loginUrl:    form.loginUrl.value.trim() || undefined,
      roleName:    form.roleName.value.trim() || 'authenticated',
      username:    form.username.value.trim() || undefined,
      password:    form.password.value || undefined,
      provider:    form.provider.value,
      maxPages:    Number(form.maxPages.value),
      maxDepth:    3,
    };

    let res;
    try {
      res = await fetch('/run', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(body),
      });
    } catch (err) {
      appendLog('[ERROR] Cannot reach server: ' + err.message);
      setRunning(false); dot.className = 'dot error'; return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({error: res.statusText}));
      appendLog('[ERROR] ' + err.error);
      setRunning(false); dot.className = 'dot error'; return;
    }

    const data = await res.json();
    currentRunId = data.runId;

    // Show generated file paths
    const lines = [data.projectFile, data.authFile].filter(Boolean).map(f => '<code>' + f + '</code>').join('<br/>');
    filesList.innerHTML = lines;
    notice.style.display = 'block';

    connectSSE(data.runId);
  });

  function connectSSE(runId) {
    if (es) es.close();
    es = new EventSource('/stream/' + runId);
    es.onmessage = (event) => {
      const line = event.data;
      if (line.startsWith('[DONE]')) {
        const code = parseInt(line.match(/exitCode=(-?\\d+)/)?.[1] ?? '-1', 10);
        setRunning(false);
        dot.className = 'dot ' + (code === 0 ? 'done' : 'error');
        if (code === 0) showReport(runId);
        loadReports();
        es.close(); return;
      }
      appendLog(line);
    };
    es.onerror = () => {
      appendLog('[Connection lost]');
      setRunning(false); dot.className = 'dot error'; es.close();
    };
  }

  async function stopRun() {
    if (!currentRunId) return;
    await fetch('/stop/' + currentRunId, {method:'POST'}).catch(()=>{});
    dot.className = 'dot stopped';
    setRunning(false);
    if (es) { es.close(); es = null; }
  }

  function appendLog(line) {
    logEl.textContent += line + '\\n';
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setRunning(running) {
    form.querySelectorAll('input,select,button[type=submit]').forEach(el => el.disabled = running);
    spinner.style.display = running ? 'block' : 'none';
    btnLabel.textContent  = running ? 'Running…' : 'Run Workflow';
    stopBtn.classList.toggle('show', running);
  }

  async function showReport(runId) {
    const reports = await fetch('/reports').then(r => r.json()).catch(() => []);
    const r = reports.find(r => r.runId === runId);
    if (r) { reportBtn.href = r.url; reportBtn.classList.add('show'); }
  }

  async function loadReports() {
    const reports = await fetch('/reports').then(r => r.json()).catch(() => []);
    const list = document.getElementById('report-list');
    if (!reports.length) {
      list.innerHTML = '<div style="color:var(--color-muted);font-size:.78rem">No reports yet.</div>';
      return;
    }
    list.innerHTML = reports.slice(0, 8).map(r => \`
      <div class="ri">
        <span class="ri-id">\${r.runId}</span>
        <a href="\${r.url}" target="_blank">View →</a>
      </div>\`).join('');
  }
</script>
</body>
</html>`;
