/**
 * P0 — Environment Testing (preflight).
 *
 * Validate the runtime is sane before any browser launches or AI calls.
 * Returns a structured outcome the workflow CLI can render and exit on.
 *
 * Reference: docs/decisions/ADR-012-workflow-architecture.md §2.P0
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../config";
import type { FrameworkConfig } from "../config";

export interface PreflightCheck {
  name: string;
  status: "passed" | "warn" | "failed";
  detail?: string;
}

export interface PreflightOutcome {
  status: "passed" | "warn" | "failed";
  checks: PreflightCheck[];
  /** Suggested exit code if the caller wants to short-circuit. */
  exitCode: number;
}

export interface PreflightOptions {
  /** When true, require Playwright browser binary to be discoverable. */
  requireBrowser?: boolean;
  /** When true, warn if GITHUB_* env not set (for PR-comment path). */
  expectGithubEnv?: boolean;
  /** When true, ping `DATABASE_URL` to warn on unreachable DB. */
  pingDatabase?: boolean;
}

export async function runPreflight(opts: PreflightOptions = {}): Promise<PreflightOutcome> {
  const checks: PreflightCheck[] = [];

  // 1. Node version (declared engines).
  checks.push(checkNodeVersion());

  // 2. Framework config + ai-provider parse cleanly.
  let cfg: FrameworkConfig | undefined;
  try {
    cfg = loadConfig();
    checks.push({ name: "config:framework", status: "passed" });
  } catch (err) {
    checks.push({
      name: "config:framework",
      status: "failed",
      detail: (err as Error).message,
    });
  }

  // 3. AI provider enablement + required env keys.
  if (cfg) {
    checks.push(...checkAiProviders(cfg));
  }

  // 4. Playwright browser presence.
  checks.push(checkPlaywrightBrowser(opts.requireBrowser ?? false));

  // 5. Optional: GitHub PR-comment env hint.
  if (opts.expectGithubEnv) {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    const pr =
      process.env.GITHUB_PR_NUMBER ?? process.env.PR_NUMBER ?? process.env.GITHUB_REF;
    if (token && repo && pr) {
      checks.push({ name: "env:github-pr", status: "passed" });
    } else {
      checks.push({
        name: "env:github-pr",
        status: "warn",
        detail: "GITHUB_TOKEN/REPOSITORY/PR not all set — PR comment will be skipped",
      });
    }
  }

  // 6. Optional: database reachability ping.
  if (opts.pingDatabase) {
    checks.push(await pingDatabase());
  }

  // Aggregate.
  const failed = checks.find((c) => c.status === "failed");
  const warned = checks.find((c) => c.status === "warn");
  const status: PreflightOutcome["status"] = failed ? "failed" : warned ? "warn" : "passed";
  const exitCode = failed ? exitCodeFor(failed) : 0;

  return { status, checks, exitCode };
}

function exitCodeFor(check: PreflightCheck): number {
  if (check.name.startsWith("browser")) return 3;
  return 2;
}

function checkNodeVersion(): PreflightCheck {
  const [majorStr] = process.versions.node.split(".");
  const major = Number(majorStr);
  if (Number.isFinite(major) && major >= 20) {
    return { name: "node:version", status: "passed", detail: process.versions.node };
  }
  return {
    name: "node:version",
    status: "failed",
    detail: `Node ${process.versions.node} < 20 required`,
  };
}

function checkAiProviders(cfg: FrameworkConfig): PreflightCheck[] {
  const out: PreflightCheck[] = [];
  const providers = cfg.ai.providers ?? {};
  const enabled = Object.entries(providers).filter(([_, spec]) => spec?.enabled);
  if (enabled.length === 0 && cfg.ai.defaultProvider !== "mock") {
    out.push({
      name: "config:ai-providers",
      status: "warn",
      detail: "No providers enabled and default is not mock — generation will fail",
    });
  } else {
    out.push({ name: "config:ai-providers", status: "passed" });
  }
  for (const [name, spec] of enabled) {
    if (!spec) continue;
    if (name === "claude" && !process.env.CLAUDE_API_KEY) {
      out.push({
        name: `provider:${name}`,
        status: "warn",
        detail: `Enabled but CLAUDE_API_KEY not set; chain will fall through`,
      });
    } else if (name === "codex" && !process.env.CODEX_API_KEY) {
      out.push({
        name: `provider:${name}`,
        status: "warn",
        detail: `Enabled but CODEX_API_KEY not set; chain will fall through`,
      });
    } else {
      out.push({ name: `provider:${name}`, status: "passed" });
    }
  }
  return out;
}

function checkPlaywrightBrowser(strict: boolean): PreflightCheck {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  // If the operator explicitly set PLAYWRIGHT_BROWSERS_PATH, trust it
  // alone — that's the standard contract. Otherwise look at the usual
  // user/system fallback paths.
  const candidates = root
    ? [
        path.join(root, "chromium-1223"),
        path.join(root, "chromium-1194"),
        root, // accept the dir itself if it contains any chromium-*
      ]
    : ([
        process.env.HOME && path.join(process.env.HOME, ".cache/ms-playwright"),
        "/opt/pw-browsers",
      ].filter(Boolean) as string[]);
  const found = candidates.find((p) => existsSync(p));
  if (found) {
    return { name: "browser:playwright", status: "passed", detail: found };
  }
  return {
    name: "browser:playwright",
    status: strict ? "failed" : "warn",
    detail:
      "No Playwright browser cache found. Run: npx playwright install chromium " +
      "(or set PLAYWRIGHT_BROWSERS_PATH)",
  };
}

async function pingDatabase(): Promise<PreflightCheck> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return {
      name: "db:reachable",
      status: "warn",
      detail: "DATABASE_URL not set — runs / scenarios / defects DB writes skipped",
    };
  }
  // Tiny TCP probe via pg without importing the whole pool. Best-effort.
  try {
    const pg = (await import("pg")) as typeof import("pg");
    const client = new pg.Client({ connectionString: url, statement_timeout: 2000 });
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("ping timeout")), 3000),
    );
    await Promise.race([
      (async () => {
        await client.connect();
        await client.query("SELECT 1");
        await client.end().catch(() => undefined);
      })(),
      deadline,
    ]);
    return { name: "db:reachable", status: "passed" };
  } catch (err) {
    return {
      name: "db:reachable",
      status: "warn",
      detail: `DB unreachable (${(err as Error).message.slice(0, 100)}); DB writes will no-op`,
    };
  }
}

export function formatPreflight(outcome: PreflightOutcome): string {
  const ICON: Record<PreflightCheck["status"], string> = {
    passed: "✓",
    warn: "!",
    failed: "✗",
  };
  const lines = ["Preflight:"];
  for (const c of outcome.checks) {
    lines.push(`  ${ICON[c.status]} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  return lines.join("\n");
}
