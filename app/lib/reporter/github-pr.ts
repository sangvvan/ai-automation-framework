import type { RunSummary } from "../validation";

const MARKER_PREFIX = "<!-- ai-test:summary:";
const MARKER_SUFFIX = " -->";
const MAX_BODY_BYTES = 64 * 1024;

export interface GithubPrEnv {
  /** GitHub bearer token. */
  token: string;
  /** "owner/repo" */
  repository: string;
  /** PR number. */
  prNumber: number;
  /** Override the API base for GHES. */
  apiBase?: string;
}

export function readGithubPrEnvFromProcess(): GithubPrEnv | null {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const pr =
    process.env.GITHUB_PR_NUMBER ??
    process.env.PR_NUMBER ??
    extractPrFromRef(process.env.GITHUB_REF);
  if (!token || !repository || !pr) return null;
  return {
    token,
    repository,
    prNumber: Number(pr),
    apiBase: process.env.GITHUB_API_URL ?? "https://api.github.com",
  };
}

function extractPrFromRef(ref: string | undefined): string | null {
  if (!ref) return null;
  const m = ref.match(/refs\/pull\/(\d+)\/merge/);
  return m?.[1] ?? null;
}

/**
 * Post (or update if existing) a single PR comment summarising the run.
 * Idempotent: subsequent calls find the existing comment by marker and
 * PATCH it instead of creating a new one.
 *
 * Returns the comment URL, or null when no PR context is present.
 */
export async function postPrComment(
  summary: RunSummary,
  links: { htmlReport?: string; junit?: string },
  env: GithubPrEnv | null,
): Promise<string | null> {
  if (!env) return null;
  const marker = `${MARKER_PREFIX}${summary.runId.slice(0, 12)}${MARKER_SUFFIX}`;
  const body = clipToSize(buildBody(summary, links, marker), MAX_BODY_BYTES);

  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${env.token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  } as const;
  const listUrl = `${env.apiBase ?? "https://api.github.com"}/repos/${env.repository}/issues/${env.prNumber}/comments?per_page=100`;
  const listRes = await fetch(listUrl, { headers });
  if (!listRes.ok) {
    throw new Error(`GitHub list-comments HTTP ${listRes.status}`);
  }
  const existing = (await listRes.json()) as Array<{ id: number; body: string; html_url: string }>;
  const existingMarker = `${MARKER_PREFIX}${summary.runId.slice(0, 12)}${MARKER_SUFFIX}`;
  const found = existing.find((c) => c.body.includes(existingMarker));
  if (found) {
    const patchUrl = `${env.apiBase ?? "https://api.github.com"}/repos/${env.repository}/issues/comments/${found.id}`;
    const r = await fetch(patchUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ body }),
    });
    if (!r.ok) throw new Error(`GitHub PATCH HTTP ${r.status}`);
    return found.html_url;
  }
  const createRes = await fetch(
    `${env.apiBase ?? "https://api.github.com"}/repos/${env.repository}/issues/${env.prNumber}/comments`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ body }),
    },
  );
  if (!createRes.ok) throw new Error(`GitHub POST HTTP ${createRes.status}`);
  const created = (await createRes.json()) as { html_url: string };
  return created.html_url;
}

export function buildBody(
  summary: RunSummary,
  links: { htmlReport?: string; junit?: string },
  marker: string,
): string {
  const t = summary.totals;
  const head = `${marker}\n### ai-test run \`${summary.runId}\` — ${t.passed}/${t.total} passed, ${t.failed} failed, ${t.skipped} skipped\n`;
  const failed = summary.scenarios
    .filter((s) => s.validation.status === "failed")
    .slice(0, 5);
  const failures = failed.length
    ? `\n**Failed scenarios** (showing ${failed.length} of ${t.failed}):\n` +
      failed
        .map(
          (s) =>
            `- \`${s.scenario.id}\` — ${s.scenario.title}: ${s.validation.failureReason ?? "failed"}`,
        )
        .join("\n")
    : "";
  const more = t.failed > failed.length ? `\n…and ${t.failed - failed.length} more — see HTML report.` : "";
  const linksMd =
    `\n\n**Artefacts**\n` +
    `- HTML report: ${links.htmlReport ?? "(not generated)"}\n` +
    `- JUnit XML:   ${links.junit ?? "(not generated)"}\n` +
    (summary.testPlanPath ? `- Test Plan:   ${summary.testPlanPath}\n` : "");
  return `${head}${failures}${more}${linksMd}\nMode: \`${summary.mode}\`, level: \`${summary.testLevel ?? "system"}\`.`;
}

function clipToSize(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;
  // Drop the failures section last (it's the easiest to truncate).
  return s.slice(0, maxBytes - 200) + "\n\n… (truncated)";
}
