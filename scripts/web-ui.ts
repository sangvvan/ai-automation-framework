/**
 * Web UI — ai-automation-framework interactive runner.
 *
 * Supported commands:
 *   workflow        → init project YAML + auth YAML → full pipeline
 *   generate-cases  → AI generate test cases from latest sitemap
 *   gen-scripts     → generate Python/TypeScript automation scripts
 *   run-suite       → run YAML test suite → HTML/JUnit report
 *   regression      → re-run approved regression corpus
 *
 * Usage:
 *   npm run web-ui
 *   PORT=8080 HOST=0.0.0.0 npm run web-ui
 */
import "dotenv/config";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
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
  if (run.status !== "stopped") run.status = exitCode === 0 ? "done" : "error";
  run.exitCode = exitCode;
  for (const sub of run.subscribers) { sseWrite(sub, `[DONE] exitCode=${exitCode}`); sub.end(); }
  run.subscribers.clear();
}

function safeSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
}

const PROVIDERS = ["gemini","claude","codex","ollama","lmstudio","mock"] as const;
type Provider = typeof PROVIDERS[number];

// ─── Project / auth YAML generators ──────────────────────────────────────────

async function createProjectFiles(opts: {
  projectName: string; baseUrl: string; loginUrl?: string;
  roleName: string; username?: string; password?: string;
  usernameLabel?: string; passwordLabel?: string; submitLabel?: string;
}): Promise<{ projectFile: string; authFile?: string; credentialSource?: string }> {
  const slug = safeSlug(opts.projectName);
  const projectFilePath = path.join(rootDir, "inputs", "projects", `${slug}.yaml`);
  let crawlCfg = { maxPages: 10, maxDepth: 3, maxConcurrency: 2, perHostQps: 2, includeSubdomains: false, ignoreRobots: false };
  if (existsSync(projectFilePath)) {
    try {
      const existing = parseYaml(await readFile(projectFilePath, "utf8")) as Record<string, unknown>;
      if (existing?.crawl && typeof existing.crawl === "object") Object.assign(crawlCfg, existing.crawl);
    } catch { /* use defaults */ }
  }
  let authFile: string | undefined;

  const effectiveUsername = opts.username || process.env.SITE_USERNAME || "";
  const effectivePassword = opts.password || process.env.SITE_PASSWORD || "";
  const credentialSource = opts.username
    ? "form"
    : effectiveUsername
      ? "env (SITE_USERNAME / SITE_PASSWORD)"
      : undefined;

  if (effectiveUsername && effectivePassword) {
    const loginUrl = opts.loginUrl || opts.baseUrl;
    const recipe = {
      id: slug, loginUrl,
      fields: {
        username: {
          locator: { kind: "role", role: "textbox", name: opts.usernameLabel || "Email" },
          value: "${SITE_USERNAME}",
        },
        password: {
          locator: { kind: "role", role: "textbox", name: opts.passwordLabel || "Password" },
          value: "${SITE_PASSWORD}",
        },
        extras: [],
      },
      submit: {
        locator: { kind: "role", role: "button", name: opts.submitLabel || "Sign in" },
      },
      postLogin: { waitFor: [] },
      expectsCaptcha: false,
    };
    authFile = path.join("inputs", "auth", `${slug}.yaml`);
    await mkdir(path.join(rootDir, "inputs", "auth"), { recursive: true });
    await writeFile(path.join(rootDir, authFile), stringifyYaml(recipe), "utf8");
  }

  const roleName = opts.roleName || (authFile ? "authenticated" : "anonymous");
  const roles = authFile
    ? [{ name: roleName, authRecipe: authFile }]
    : [{ name: roleName }];

  const yaml = {
    project: opts.projectName, baseUrl: opts.baseUrl, roles,
    crawl: crawlCfg,
    generation: { outputDir: "tests/generated", maxScenariosPerPage: 14, fallbackSmoke: true },
    run: {
      testLevel: "system", browsers: ["chromium"], locales: [],
      nonFunctional: { a11y: true, a11yFailOn: [], vitals: true, securityHeaders: true },
      junit: true, testPlan: true, persistDefects: true, prComment: false,
      suiteTag: slug,
    },
  };

  const projectFile = path.join("inputs", "projects", `${slug}.yaml`);
  await mkdir(path.join(rootDir, "inputs", "projects"), { recursive: true });
  await writeFile(path.join(rootDir, projectFile), stringifyYaml(yaml), "utf8");
  return { projectFile, authFile, credentialSource };
}

// ─── Input schemas ────────────────────────────────────────────────────────────

const providerEnum = z.enum(PROVIDERS).default("gemini");

const WorkflowSchema = z.object({
  command:       z.literal("workflow"),
  projectName:   z.string().min(1).max(80),
  baseUrl:       z.string().url(),
  loginUrl:      z.string().optional(),
  roleName:      z.string().max(40).default("authenticated"),
  username:      z.string().max(256).optional(),
  password:      z.string().max(1024).optional(),
  usernameLabel: z.string().max(80).optional(),
  passwordLabel: z.string().max(80).optional(),
  submitLabel:   z.string().max(80).optional(),
  provider:      providerEnum,
});

const GenerateCasesSchema = z.object({
  command:  z.literal("generate-cases"),
  project:  z.string().min(1),
  role:     z.string().min(1),
  provider: providerEnum,
});

const GenScriptsSchema = z.object({
  command:  z.literal("gen-scripts"),
  project:  z.string().min(1),
  role:     z.string().min(1),
  language: z.enum(["python", "typescript"]).default("python"),
});

const RunSuiteSchema = z.object({
  command:         z.literal("run-suite"),
  project:         z.string().min(1),
  role:            z.string().min(1),
  browsers:        z.string().max(120).default("chromium"),
  a11y:            z.boolean().default(false),
  vitals:          z.boolean().default(false),
  securityHeaders: z.boolean().default(false),
});

const RegressionSchema = z.object({
  command:         z.literal("regression"),
  feature:         z.string().max(80).optional(),
  browsers:        z.string().max(120).default("chromium"),
  a11y:            z.boolean().default(false),
  vitals:          z.boolean().default(false),
  securityHeaders: z.boolean().default(false),
});

const RunSchema = z.discriminatedUnion("command", [
  WorkflowSchema, GenerateCasesSchema, GenScriptsSchema, RunSuiteSchema, RegressionSchema,
]);

// ─── Project helpers ──────────────────────────────────────────────────────────

interface ProjectInfo {
  name: string; baseUrl: string; outputDir: string;
  crawl: { maxPages: number; maxDepth: number; maxConcurrency: number; perHostQps: number };
  role: { name: string; authRecipe?: string };
}

async function readProjectInfo(slug: string, roleName: string): Promise<ProjectInfo | null> {
  const p = path.join(rootDir, "inputs", "projects", `${slug}.yaml`);
  if (!existsSync(p)) return null;
  const c = parseYaml(await readFile(p, "utf8")) as Record<string, unknown>;
  const roles = (c.roles as { name: string; authRecipe?: string }[]) ?? [];
  const role = roles.find(r => r.name === roleName) ?? { name: roleName };
  const crawlRaw = (c.crawl ?? {}) as Record<string, number>;
  return {
    name: (c.project as string) ?? slug,
    baseUrl: c.baseUrl as string,
    outputDir: ((c.generation as Record<string, string>)?.outputDir) ?? "tests/generated",
    crawl: { maxPages: 25, maxDepth: 3, maxConcurrency: 2, perHostQps: 2, ...crawlRaw },
    role,
  };
}

function latestSitemapInDir(dir: string): Promise<string | undefined> {
  return readdir(dir).then(files => {
    const sorted = files.filter(f => f.endsWith(".json")).sort().reverse();
    return sorted.length ? path.join(dir, sorted[0]) : undefined;
  }).catch(() => undefined);
}

// ─── Spawn helper ─────────────────────────────────────────────────────────────

function spawnCli(argv: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn("npx", argv, { env, stdio: ["ignore", "pipe", "pipe"], shell: false, cwd: rootDir });
}

function attachChild(child: ChildProcess, record: RunRecord) {
  const onChunk = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n"))
      if (line.trim()) broadcast(record, line);
  };
  child.stdout!.on("data", onChunk);
  child.stderr!.on("data", onChunk);
  child.on("exit", code => finishRun(record, code ?? -1));
  child.on("error", err => { broadcast(record, `[ERROR] ${err.message}`); finishRun(record, -1); });
}

function mkRecord(id: string, child: ChildProcess): RunRecord {
  const record: RunRecord = {
    id, status: "running", exitCode: null,
    startedAt: new Date(), logBuffer: [], subscribers: new Set(), child,
  };
  runs.set(id, record);
  return record;
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_req: Request, res: Response) => res.send(PAGE_HTML));

// ── POST /run ─────────────────────────────────────────────────────────────────
app.post("/run", async (req: Request, res: Response) => {
  const parsed = RunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const running = [...runs.values()].filter(r => r.status === "running").length;
  if (running >= MAX_CONCURRENT) {
    res.status(429).json({ error: "Too many concurrent runs. Stop one first." });
    return;
  }

  const input = parsed.data;
  const runId = generateRunId("W");
  const script = path.resolve(__dirname, "ai-test.ts");
  const env: NodeJS.ProcessEnv = { ...process.env };
  let argv: string[];
  let initNote: string | undefined;

  if (input.command === "workflow") {
    let projectFile: string, authFile: string | undefined, credentialSource: string | undefined;
    try {
      ({ projectFile, authFile, credentialSource } = await createProjectFiles({
        projectName:   input.projectName, baseUrl: input.baseUrl,
        loginUrl:      input.loginUrl,    roleName: input.roleName,
        username:      input.username,    password: input.password,
        usernameLabel: input.usernameLabel,
        passwordLabel: input.passwordLabel,
        submitLabel:   input.submitLabel,
      }));
    } catch (err) {
      res.status(500).json({ error: `Config file creation failed: ${(err as Error).message}` });
      return;
    }
    argv = ["vite-node", script, "workflow", "--input", path.resolve(rootDir, projectFile), "--skip-preflight"];
    env.AI_TEST_DEFAULT_PROVIDER = input.provider;
    env.SITE_USERNAME = input.username || process.env.SITE_USERNAME || "";
    env.SITE_PASSWORD = input.password || process.env.SITE_PASSWORD || "";
    initNote = JSON.stringify({ projectFile, authFile, credentialSource });

  } else if (input.command === "generate-cases") {
    const info = await readProjectInfo(input.project, input.role);
    if (!info) { res.status(400).json({ error: `Project not found: ${input.project}` }); return; }
    const manifestPath = path.join(rootDir, info.outputDir, input.project, input.role, "manifest.json");
    let sitemapPath: string | undefined;
    if (existsSync(manifestPath)) {
      const mf = JSON.parse(await readFile(manifestPath, "utf8")) as { siteMapPath: string };
      const abs = path.resolve(rootDir, mf.siteMapPath);
      if (existsSync(abs)) sitemapPath = abs;
    }
    if (!sitemapPath) sitemapPath = await latestSitemapInDir(path.join(rootDir, "reports", "sitemaps"));
    if (!sitemapPath) { res.status(400).json({ error: "No sitemaps found. Run Workflow first to crawl the site." }); return; }
    // Pin --output-dir to the slug-based directory so cases land exactly where
    // Gen Scripts / Run Suite later read them.
    const genOutputDir = path.join(rootDir, info.outputDir, input.project, input.role);
    argv = ["vite-node", script, "generate", "--site-map", sitemapPath,
      "--project", info.name, "--role", input.role, "--output-dir", genOutputDir];
    const ss = path.join(rootDir, "reports", "auth", input.project, `${input.role}.storage-state.json`);
    if (existsSync(ss)) argv.push("--storage-state", ss);
    env.AI_TEST_DEFAULT_PROVIDER = input.provider;

  } else if (input.command === "gen-scripts") {
    const info = await readProjectInfo(input.project, input.role);
    if (!info) { res.status(400).json({ error: `Project not found: ${input.project}` }); return; }
    const manifestPath = path.join(rootDir, info.outputDir, input.project, input.role, "manifest.json");
    if (!existsSync(manifestPath)) { res.status(400).json({ error: "No test cases found. Run Generate Cases first." }); return; }
    argv = ["vite-node", script, "generate-scripts", "--manifest", manifestPath, `--language=${input.language}`];

  } else if (input.command === "run-suite") {
    const info = await readProjectInfo(input.project, input.role);
    if (!info) { res.status(400).json({ error: `Project not found: ${input.project}` }); return; }
    const casesDir = path.join(rootDir, info.outputDir, input.project, input.role);
    if (!existsSync(casesDir)) { res.status(400).json({ error: "No test cases found. Run Generate Cases first." }); return; }
    argv = ["vite-node", script, "run-suite", "--cases-dir", casesDir, "--project", info.name, "--role", input.role];
    if (input.browsers) argv.push("--browsers", input.browsers);
    if (input.a11y) argv.push("--a11y");
    if (input.vitals) argv.push("--vitals");
    if (input.securityHeaders) argv.push("--security-headers");
    const ss = path.join(rootDir, "reports", "auth", input.project, `${input.role}.storage-state.json`);
    if (existsSync(ss)) argv.push("--storage-state", ss);
    const manifestPath = path.join(casesDir, "manifest.json");
    if (existsSync(manifestPath)) {
      const mf = JSON.parse(await readFile(manifestPath, "utf8")) as { siteMapPath: string };
      const smAbs = path.resolve(rootDir, mf.siteMapPath);
      if (existsSync(smAbs)) argv.push("--site-map", smAbs);
    }

  } else {
    // regression
    argv = ["vite-node", script, "regression", "--no-pr-comment"];
    if (input.feature) argv.push("--feature", input.feature);
    if (input.browsers) argv.push("--browsers", input.browsers);
    if (input.a11y) argv.push("--a11y");
    if (input.vitals) argv.push("--vitals");
    if (input.securityHeaders) argv.push("--security-headers");
  }

  const child = spawnCli(argv, env);
  const record = mkRecord(runId, child);
  attachChild(child, record);

  res.status(202).json({ runId, initNote });
});

// ── POST /stop/:runId ─────────────────────────────────────────────────────────
app.post("/stop/:runId", (req: Request<{ runId: string }>, res: Response) => {
  const run = runs.get(req.params.runId);
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }
  if (run.status !== "running") { res.status(400).json({ error: "Run not active" }); return; }
  run.status = "stopped";
  broadcast(run, "[STOPPED] Run cancelled by user.");
  run.child.kill("SIGTERM");
  setTimeout(() => { if (run.status === "stopped") run.child.kill("SIGKILL"); }, 5000);
  finishRun(run, -1);
  res.json({ ok: true });
});

// ── GET /stream/:runId ────────────────────────────────────────────────────────
app.get("/stream/:runId", (req: Request<{ runId: string }>, res: Response) => {
  const run = runs.get(req.params.runId);
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  for (const line of run.logBuffer) sseWrite(res, line);
  if (run.status !== "running") { sseWrite(res, `[DONE] exitCode=${run.exitCode ?? -1}`); res.end(); return; }
  run.subscribers.add(res);
  req.on("close", () => run.subscribers.delete(res));
});

// ── GET /ping?url=<url> ───────────────────────────────────────────────────────
app.get("/ping", async (req: Request, res: Response) => {
  const target = String(req.query.url ?? "");
  if (!target.startsWith("http")) { res.json({ ok: false, reason: "invalid url" }); return; }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(target, { method: "HEAD", signal: ctrl.signal }).catch(() =>
      fetch(target, { method: "GET", signal: ctrl.signal }),
    );
    clearTimeout(timer);
    res.json({ ok: r.ok || r.status < 500, status: r.status });
  } catch (err) {
    res.json({ ok: false, reason: (err as Error).message });
  }
});

// ── GET /projects — list projects + roles for dropdowns ──────────────────────
app.get("/projects", async (_req: Request, res: Response) => {
  const projectsDir = path.join(rootDir, "inputs", "projects");
  const result: {
    slug: string; name: string; baseUrl: string;
    roles: { name: string; hasCases: boolean; hasManifest: boolean }[];
  }[] = [];
  try {
    for (const f of (await readdir(projectsDir)).filter(f => /\.ya?ml$/.test(f))) {
      try {
        const slug = f.replace(/\.ya?ml$/, "");
        const c = parseYaml(await readFile(path.join(projectsDir, f), "utf8")) as Record<string, unknown>;
        const outputDir = ((c.generation as Record<string, string>)?.outputDir) ?? "tests/generated";
        const roles = ((c.roles as { name: string }[]) ?? []).map(r => {
          const casesDir = path.join(rootDir, outputDir, slug, r.name);
          return {
            name: r.name,
            hasCases: existsSync(casesDir),
            hasManifest: existsSync(path.join(casesDir, "manifest.json")),
          };
        });
        result.push({ slug, name: (c.project as string) ?? slug, baseUrl: c.baseUrl as string, roles });
      } catch { /* skip malformed */ }
    }
  } catch { /* no projects dir */ }
  result.sort((a, b) => a.name.localeCompare(b.name));
  res.json(result);
});

// ── GET /reports ──────────────────────────────────────────────────────────────
app.get("/reports", async (_req: Request, res: Response) => {
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
    :root{
      --bg-app:#f8fafc;--bg-card:#fff;--color-text:#0f172a;--color-muted:#64748b;
      --color-ok:#10b981;--color-ko:#ef4444;--color-warn:#f59e0b;
      --color-info:#3b82f6;--color-info-bg:#e8f0fe;--color-info-text:#1a73e8;
      --color-sk-bg:#f1f5f9;--border:#e2e8f0;--shadow-sm:0 1px 2px rgba(0,0,0,.05);
      --font:'Plus Jakarta Sans',system-ui,sans-serif;
    }
    @media(prefers-color-scheme:dark){
      :root{--bg-app:#090d16;--bg-card:#111827;--color-text:#f3f4f6;--color-muted:#9ca3af;
        --color-info-bg:rgba(96,165,250,.1);--color-info-text:#60a5fa;
        --color-sk-bg:rgba(156,163,175,.1);--border:#1f2937;}
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
    .panel-title{font-size:.95rem;font-weight:700;margin-bottom:16px;
      padding-bottom:12px;border-bottom:1px solid var(--border)}

    /* Command selector — 5 equal columns */
    .cmd-selector{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:18px}
    .cmd-btn{padding:8px 4px;border:1px solid var(--border);border-radius:7px;
      background:var(--bg-card);color:var(--color-muted);font-family:var(--font);
      font-size:.72rem;font-weight:600;cursor:pointer;text-align:center;
      transition:all .15s;line-height:1.3}
    .cmd-btn:hover{border-color:var(--color-info);color:var(--color-info-text);
      background:var(--color-info-bg)}
    .cmd-btn.active{border-color:var(--color-info);background:var(--color-info-bg);
      color:var(--color-info-text)}
    .cmd-btn .icon{font-size:1.2rem;display:block;margin-bottom:4px}

    /* Command description badge */
    .cmd-desc{font-size:.78rem;color:var(--color-muted);background:var(--color-sk-bg);
      border-radius:6px;padding:8px 10px;margin-bottom:16px;border-left:3px solid var(--color-info)}

    /* Section labels */
    .sec{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
      color:var(--color-muted);margin:16px 0 10px;display:flex;align-items:center;gap:8px}
    .sec::after{content:'';flex:1;height:1px;background:var(--border)}

    .field{margin-bottom:11px}
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

    /* Check toggle */
    .check-row{display:flex;align-items:center;gap:8px;font-size:.85rem;
      font-weight:500;cursor:pointer;margin-bottom:11px}
    .check-row input{width:15px;height:15px;accent-color:var(--color-info)}

    .btn-row{display:flex;gap:10px;margin-top:16px}
    .btn-run{flex:1;padding:11px;border-radius:8px;border:none;
      background:var(--color-info);color:#fff;font-family:var(--font);
      font-size:.9rem;font-weight:700;cursor:pointer;
      display:flex;align-items:center;justify-content:center;gap:8px;
      transition:opacity .2s}
    .btn-run:hover{opacity:.88}
    .btn-run:disabled{opacity:.45;cursor:not-allowed}
    .btn-stop{padding:11px 14px;border-radius:8px;border:1px solid var(--color-ko);
      background:rgba(239,68,68,.08);color:var(--color-ko);font-family:var(--font);
      font-size:.9rem;font-weight:700;cursor:pointer;
      display:none;align-items:center;gap:6px;transition:background .15s}
    .btn-stop:hover{background:rgba(239,68,68,.16)}
    .btn-stop.show{display:flex}

    @keyframes spin{to{transform:rotate(360deg)}}
    .spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,.3);
      border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;display:none}

    .files-notice{margin-top:12px;padding:9px 11px;border-radius:7px;
      background:var(--color-sk-bg);border:1px solid var(--border);
      font-size:.77rem;color:var(--color-muted);display:none}
    .files-notice code{font-family:monospace;color:var(--color-info-text)}

    /* Target app reachability banner */
    .reach-banner{margin-bottom:14px;padding:8px 11px;border-radius:7px;
      font-size:.77rem;display:none;align-items:center;gap:8px}
    .reach-banner.ok{background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.3);
      color:#059669}
    .reach-banner.fail{background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.3);
      color:var(--color-ko)}
    .reach-banner.checking{background:var(--color-sk-bg);border:1px solid var(--border);
      color:var(--color-muted)}

    /* Right panel */
    .log-panel .panel-title{display:flex;justify-content:space-between;align-items:center}
    .dot{width:9px;height:9px;border-radius:50%;background:var(--border);transition:background .3s}
    .dot.running{background:var(--color-warn);animation:pulse 1s ease-in-out infinite}
    .dot.done{background:var(--color-ok)}
    .dot.error,.dot.stopped{background:var(--color-ko)}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

    #log-ph{color:#484f58;font-family:ui-monospace,monospace;font-size:.78rem;
      height:430px;display:flex;align-items:center;justify-content:center;
      border:1px solid #30363d;border-radius:8px;background:#0d1117}
    #log{background:#0d1117;color:#7ee787;
      font-family:'JetBrains Mono','Fira Code',ui-monospace,monospace;
      font-size:.77rem;line-height:1.7;padding:14px;border-radius:8px;
      height:430px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;
      border:1px solid #30363d;display:none}

    .btn-report{display:none;margin-top:12px;padding:9px 14px;border-radius:8px;
      border:1px solid var(--color-ok);background:rgba(16,185,129,.1);color:var(--color-ok);
      font-family:var(--font);font-size:.85rem;font-weight:700;
      text-decoration:none;align-items:center;gap:7px;transition:background .15s}
    .btn-report:hover{background:rgba(16,185,129,.2)}
    .btn-report.show{display:inline-flex}

    .recent{margin-top:16px}
    .recent-title{font-size:.7rem;font-weight:700;text-transform:uppercase;
      letter-spacing:.07em;color:var(--color-muted);margin-bottom:8px}
    .ri{display:flex;align-items:center;justify-content:space-between;
      padding:6px 10px;border:1px solid var(--border);border-radius:7px;
      font-size:.78rem;margin-bottom:4px}
    .ri a{color:var(--color-info-text);text-decoration:none;font-weight:600}
    .ri a:hover{text-decoration:underline}
    .ri-id{font-family:monospace;font-size:.72rem;color:var(--color-muted)}

    .ftr{margin-top:40px;border-top:1px solid var(--border);
      padding:16px 32px;font-size:.78rem;color:var(--color-muted);text-align:center}

    /* Dynamic sections */
    .cmd-section{display:none}
    .cmd-section.active{display:block}
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
      <div class="sub">ai-automation-framework — interactive runner</div>
    </div>
  </div>
</header>

<main class="main">
  <!-- Left panel -->
  <div class="panel">
    <div class="panel-title">Configure</div>

    <!-- 5 command buttons -->
    <div class="cmd-selector">
      <button type="button" class="cmd-btn active" data-cmd="workflow" onclick="setCmd('workflow')">
        <span class="icon">🔄</span>Workflow
      </button>
      <button type="button" class="cmd-btn" data-cmd="generate-cases" onclick="setCmd('generate-cases')">
        <span class="icon">🤖</span>Gen Cases
      </button>
      <button type="button" class="cmd-btn" data-cmd="gen-scripts" onclick="setCmd('gen-scripts')">
        <span class="icon">📝</span>Gen Scripts
      </button>
      <button type="button" class="cmd-btn" data-cmd="run-suite" onclick="setCmd('run-suite')">
        <span class="icon">▶</span>Run Suite
      </button>
      <button type="button" class="cmd-btn" data-cmd="regression" onclick="setCmd('regression')">
        <span class="icon">🛡</span>Regression
      </button>
    </div>

    <div class="cmd-desc" id="cmd-desc"></div>

    <form id="form" autocomplete="off">
      <input type="hidden" name="command" id="command-input" value="workflow"/>

      <!-- ═══ WORKFLOW ════════════════════════════════════════════════════════ -->
      <div class="cmd-section active" id="sec-workflow">
        <div class="sec">Project</div>
        <div class="field">
          <label>Project Name *</label>
          <input name="projectName" type="text" placeholder="My App"/>
          <div class="hint">Creates <code>inputs/projects/my-app.yaml</code></div>
        </div>
        <div class="field">
          <label>Base URL *</label>
          <input name="baseUrl" type="url" placeholder="https://myapp.com" id="baseUrl-input" oninput="scheduleReachCheck(this.value)"/>
          <div class="reach-banner" id="reach-banner"></div>
        </div>

        <div class="sec">Authentication <span style="font-weight:400;text-transform:none;font-size:.8rem">(optional)</span></div>
        <div class="field">
          <label>Login URL</label>
          <input name="loginUrl" type="url" placeholder="https://myapp.com/login"/>
        </div>
        <div class="field">
          <label>Role Name</label>
          <input name="roleName" type="text" placeholder="authenticated" value="authenticated"/>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Username / Email</label>
            <input name="username" type="text" placeholder="admin@example.com" autocomplete="off"/>
          </div>
          <div class="field">
            <label>Password</label>
            <input name="password" type="password" placeholder="••••••••" autocomplete="new-password"/>
          </div>
        </div>
        <input name="usernameLabel" type="hidden" value=""/>
        <input name="passwordLabel" type="hidden" value=""/>
        <input name="submitLabel" type="hidden" value=""/>
      </div>

      <!-- ═══ GENERATE CASES ════════════════════════════════════════════════ -->
      <div class="cmd-section" id="sec-generate-cases">
        <div class="sec">Project</div>
        <div class="field-row">
          <div class="field">
            <label>Project *</label>
            <select name="genCasesProject" id="generate-cases-project" onchange="onProjectChange('generate-cases')">
              <option value="">— select —</option>
            </select>
          </div>
          <div class="field">
            <label>Role *</label>
            <select name="genCasesRole" id="generate-cases-role"><option value="">— select —</option></select>
          </div>
        </div>
        <div class="hint">AI generates test cases from the latest sitemap. Existing cases are preserved unless the scenario hash changes.</div>
      </div>

      <!-- ═══ GENERATE SCRIPTS ══════════════════════════════════════════════ -->
      <div class="cmd-section" id="sec-gen-scripts">
        <div class="sec">Project</div>
        <div class="field-row">
          <div class="field">
            <label>Project *</label>
            <select name="genScriptsProject" id="gen-scripts-project" onchange="onProjectChange('gen-scripts')">
              <option value="">— select —</option>
            </select>
          </div>
          <div class="field">
            <label>Role *</label>
            <select name="genScriptsRole" id="gen-scripts-role"><option value="">— select —</option></select>
          </div>
        </div>
        <div class="field">
          <label>Language</label>
          <select name="genScriptsLang">
            <option value="python">Python — pytest + Playwright + POM</option>
            <option value="typescript">TypeScript — Playwright .spec.ts + POM</option>
          </select>
        </div>
        <div class="hint">Requires existing test cases (manifest.json). Custom zones are never overwritten.</div>
      </div>

      <!-- ═══ RUN SUITE ═════════════════════════════════════════════════════ -->
      <div class="cmd-section" id="sec-run-suite">
        <div class="sec">Project</div>
        <div class="field-row">
          <div class="field">
            <label>Project *</label>
            <select name="runSuiteProject" id="run-suite-project" onchange="onProjectChange('run-suite')">
              <option value="">— select —</option>
            </select>
          </div>
          <div class="field">
            <label>Role *</label>
            <select name="runSuiteRole" id="run-suite-role"><option value="">— select —</option></select>
          </div>
        </div>
        <div class="field">
          <label>Browsers</label>
          <select name="runSuiteBrowsers">
            <option value="chromium">chromium</option>
            <option value="chromium,firefox">chromium + firefox</option>
            <option value="chromium,firefox,webkit">chromium + firefox + webkit</option>
          </select>
        </div>
        <label class="check-row"><input type="checkbox" name="runSuiteA11y"/> Accessibility (axe-core)</label>
        <label class="check-row"><input type="checkbox" name="runSuiteVitals"/> Web Vitals</label>
        <label class="check-row"><input type="checkbox" name="runSuiteSecHeaders"/> Security headers</label>
        <div class="hint">Runs YAML test suite → HTML + JUnit report. Auth state is reused if available.</div>
      </div>

      <!-- ═══ REGRESSION ════════════════════════════════════════════════════ -->
      <div class="cmd-section" id="sec-regression">
        <div class="sec">Regression Corpus</div>
        <div class="field">
          <label>Feature (optional)</label>
          <input name="regFeature" type="text" placeholder="e.g. auth — leave blank to run all"/>
          <div class="hint">Runs <code>tests/regression/&lt;feature&gt;</code> or the whole corpus. Promote scenarios via the Review UI first.</div>
        </div>
        <div class="field">
          <label>Browsers</label>
          <select name="regBrowsers">
            <option value="chromium">chromium</option>
            <option value="chromium,firefox">chromium + firefox</option>
            <option value="chromium,firefox,webkit">chromium + firefox + webkit</option>
          </select>
        </div>
        <label class="check-row"><input type="checkbox" name="regA11y"/> Accessibility (axe-core)</label>
        <label class="check-row"><input type="checkbox" name="regVitals"/> Web Vitals</label>
        <label class="check-row"><input type="checkbox" name="regSecHeaders"/> Security headers</label>
      </div>

      <!-- ═══ AI Provider (workflow + generate-cases only) ═════════════════ -->
      <div class="cmd-section provider-row" id="sec-provider">
        <div class="sec">AI Provider</div>
        <div class="field">
          <select name="provider">
            <option value="gemini">⭐ Gemini 2.5 Pro — Google AI Pro</option>
            <option value="claude">Claude Sonnet 4.6 — Anthropic</option>
            <option value="codex">GPT-4o — OpenAI</option>
            <option value="ollama">Ollama (gemma-4-31B-it-FP8) — Local</option>
            <option value="lmstudio">LM Studio (gemma-4) — Local</option>
            <option value="mock">Mock — No API key (dev/test)</option>
          </select>
        </div>
      </div>

      <div class="btn-row">
        <button type="submit" class="btn-run" id="run-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <span id="btn-label">Run</span>
          <div class="spinner" id="spinner"></div>
        </button>
        <button type="button" class="btn-stop" id="stop-btn" onclick="stopRun()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>
          Stop
        </button>
      </div>

      <div class="files-notice" id="files-notice">
        <strong>Generated:</strong>&nbsp;<span id="files-list"></span>
      </div>
    </form>
  </div>

  <!-- Right panel -->
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
  const CMD_META = {
    workflow:         { label:'Run Workflow',    desc:'Init project config → crawl site → AI generate test cases → run suite → HTML report', provider:true  },
    'generate-cases': { label:'Generate Cases',  desc:'AI generates/updates test cases from the latest sitemap. Run Workflow first to crawl.', provider:true  },
    'gen-scripts':    { label:'Generate Scripts',desc:'Generate Python pytest or TypeScript Playwright scripts from existing test cases. Custom zones are never overwritten.', provider:false },
    'run-suite':      { label:'Run Suite',       desc:'Run YAML test suite for the selected project/role → HTML + JUnit report.', provider:false },
    regression:       { label:'Run Regression',  desc:'Re-run the approved regression corpus (tests/regression) → HTML + JUnit report.', provider:false },
  };

  let currentCmd  = 'workflow';
  let currentRunId = null;
  let es = null;

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

  // ── Reachability check ────────────────────────────────────────────────────
  let _reachTimer = null;
  function scheduleReachCheck(url) {
    clearTimeout(_reachTimer);
    const banner = document.getElementById('reach-banner');
    if (!url || !url.startsWith('http')) { banner.style.display='none'; return; }
    banner.className = 'reach-banner checking';
    banner.style.display = 'flex';
    banner.textContent = 'Checking if target app is reachable…';
    _reachTimer = setTimeout(() => checkReach(url), 700);
  }
  async function checkReach(url) {
    const banner = document.getElementById('reach-banner');
    try {
      const r = await fetch('/ping?url=' + encodeURIComponent(url));
      const d = await r.json();
      if (d.ok) {
        banner.className = 'reach-banner ok';
        banner.textContent = '✓ Target app is reachable — ready to run';
      } else {
        banner.className = 'reach-banner fail';
        banner.innerHTML = '⚠ Target app not reachable (' + (d.reason || 'HTTP ' + d.status) + '). ' +
          'Start the app first (e.g. <code>docker compose up</code>) before running the workflow.';
      }
    } catch { banner.style.display = 'none'; }
  }

  // Boot
  setCmd('workflow');
  loadReports();

  function setCmd(cmd) {
    currentCmd = cmd;
    document.getElementById('command-input').value = cmd;

    document.querySelectorAll('.cmd-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.cmd === cmd));

    document.querySelectorAll('.cmd-section').forEach(s =>
      s.classList.remove('active'));
    const sec = document.getElementById('sec-' + cmd);
    if (sec) sec.classList.add('active');

    // Provider row only for workflow and generate-cases
    document.getElementById('sec-provider').classList.toggle('active',
      CMD_META[cmd]?.provider ?? false);

    document.getElementById('cmd-desc').textContent = CMD_META[cmd]?.desc ?? '';
    btnLabel.textContent = CMD_META[cmd]?.label ?? 'Run';

    if (['generate-cases','gen-scripts','run-suite'].includes(cmd)) loadProjects(cmd);
  }

  let _projects = [];
  async function loadProjects(cmd) {
    if (!_projects.length)
      _projects = await fetch('/projects').then(r => r.json()).catch(() => []);
    const projSel = document.getElementById(cmd + '-project');
    if (!projSel) return;
    const prev = projSel.value;
    projSel.innerHTML = '<option value="">— select project —</option>';
    _projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.slug;
      opt.textContent = p.name + '  (' + p.baseUrl + ')';
      if (p.slug === prev) opt.selected = true;
      projSel.appendChild(opt);
    });
    onProjectChange(cmd, true);
  }

  function onProjectChange(cmd, keepRole) {
    const projSel = document.getElementById(cmd + '-project');
    const roleSel = document.getElementById(cmd + '-role');
    if (!projSel || !roleSel) return;
    const project = _projects.find(p => p.slug === projSel.value);
    const prev = keepRole ? roleSel.value : '';
    roleSel.innerHTML = '<option value="">— select role —</option>';
    if (project) {
      project.roles.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.name;
        const tags = [];
        if (!r.hasCases)    tags.push('no cases');
        if (!r.hasManifest) tags.push('no manifest');
        opt.textContent = r.name + (tags.length ? '  [' + tags.join(', ') + ']' : '');
        if (r.name === prev) opt.selected = true;
        roleSel.appendChild(opt);
      });
      if (project.roles.length === 1) roleSel.value = project.roles[0].name;
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setRunning(true);
    logEl.textContent = '';
    logPH.style.display = 'none';
    logEl.style.display = 'block';
    reportBtn.classList.remove('show');
    notice.style.display = 'none';
    dot.className = 'dot running';

    const cmd = currentCmd;
    let body = { command: cmd };

    if (cmd === 'workflow') {
      Object.assign(body, {
        projectName:   form.projectName.value.trim(),
        baseUrl:       form.baseUrl.value.trim(),
        loginUrl:      form.loginUrl.value.trim() || undefined,
        roleName:      form.roleName.value.trim() || 'authenticated',
        username:      form.username.value.trim() || undefined,
        password:      form.password.value || undefined,
        usernameLabel: form.usernameLabel.value.trim() || undefined,
        passwordLabel: form.passwordLabel.value.trim() || undefined,
        submitLabel:   form.submitLabel.value.trim() || undefined,
        provider:      form.provider.value,
      });
    } else if (cmd === 'generate-cases') {
      Object.assign(body, {
        project:  form.genCasesProject.value,
        role:     form.genCasesRole.value,
        provider: form.provider.value,
      });
    } else if (cmd === 'gen-scripts') {
      Object.assign(body, {
        project:  form.genScriptsProject.value,
        role:     form.genScriptsRole.value,
        language: form.genScriptsLang.value,
      });
    } else if (cmd === 'run-suite') {
      Object.assign(body, {
        project:         form.runSuiteProject.value,
        role:            form.runSuiteRole.value,
        browsers:        form.runSuiteBrowsers.value,
        a11y:            form.runSuiteA11y.checked,
        vitals:          form.runSuiteVitals.checked,
        securityHeaders: form.runSuiteSecHeaders.checked,
      });
    } else if (cmd === 'regression') {
      Object.assign(body, {
        feature:         form.regFeature.value.trim() || undefined,
        browsers:        form.regBrowsers.value,
        a11y:            form.regA11y.checked,
        vitals:          form.regVitals.checked,
        securityHeaders: form.regSecHeaders.checked,
      });
    }

    let res;
    try {
      res = await fetch('/run', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body),
      });
    } catch(err) {
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

    if (data.initNote) {
      try {
        const f = JSON.parse(data.initNote);
        let html = [f.projectFile, f.authFile].filter(Boolean)
          .map(p => '<code>' + p + '</code>').join(' &nbsp;·&nbsp; ');
        if (f.authFile && f.credentialSource)
          html += ' &nbsp;<span style="color:var(--color-ok)">✓ credentials from ' + f.credentialSource + '</span>';
        if (!f.authFile)
          html += ' &nbsp;<span style="color:var(--color-warn)">⚠ no auth — add SITE_USERNAME/SITE_PASSWORD to .env or fill in the credentials fields</span>';
        filesList.innerHTML = html;
        notice.style.display = 'block';
      } catch {}
    }

    connectSSE(data.runId, cmd);
  });

  function connectSSE(runId, cmd) {
    if (es) es.close();
    es = new EventSource('/stream/' + runId);
    es.onmessage = (event) => {
      const line = event.data;
      if (line.startsWith('[DONE]')) {
        const code = parseInt(line.match(/exitCode=(-?\\d+)/)?.[1] ?? '-1', 10);
        setRunning(false);
        dot.className = 'dot ' + (code === 0 ? 'done' : 'error');
        if (code === 0 && ['workflow','run-suite','regression'].includes(cmd))
          showReport(runId);
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
    document.querySelectorAll('.cmd-btn').forEach(b => b.disabled = running);
    spinner.style.display  = running ? 'block' : 'none';
    btnLabel.textContent   = running ? 'Running…' : (CMD_META[currentCmd]?.label ?? 'Run');
    stopBtn.style.display  = running ? 'flex' : 'none';
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
