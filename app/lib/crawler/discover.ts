import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { launchBrowser } from "../browser/launcher";
import {
  CrawlConfig,
  type CrawlExitReason,
  type SiteMap,
  type SiteMapPage,
  type SkippedEntry,
  type SkippedReason,
} from "../validation/sitemap";
import {
  normalizeUrl,
  registrableDomainOf,
  sameOrigin,
  sameRegistrableDomain,
} from "./normalize";
import { PerHostRateLimiter, realClock, type Clock } from "./rate-limiter";
import { collapseRoute } from "./route-pattern";
import { fetchRobots, isAllowed, type RobotsRules } from "./robots";

const USER_AGENT_BASE = "ai-test/0.2 (+https://github.com/sangvvan/ai-automation-framework)";

export interface DiscoverOptions {
  entryUrl: string;
  config?: Partial<CrawlConfig>;
  /** Optional storageState file from REQ-010 auth flow. */
  storageStatePath?: string;
  /** Where to write per-page evidence. Default: reports/evidence/{crawl-id}/. */
  evidenceRoot?: string;
  /** For tests: inject a virtual clock to skip wall-time waits. */
  clock?: Clock;
  /** Optional crawl id (defaults to a random one). */
  crawlId?: string;
  /** Stop signal. */
  signal?: AbortSignal;
}

interface FrontierItem {
  url: string;
  depth: number;
}

export async function discoverSiteMap(opts: DiscoverOptions): Promise<SiteMap> {
  const cfg = CrawlConfig.parse(opts.config ?? {});
  const clock = opts.clock ?? realClock;
  const crawlId = opts.crawlId ?? generateCrawlId();
  const startedAt = new Date().toISOString();
  const evidenceRoot =
    opts.evidenceRoot ?? path.join("reports", "evidence", crawlId);
  await mkdir(evidenceRoot, { recursive: true });

  const userAgent = cfg.userAgentSuffix
    ? `${USER_AGENT_BASE} ${cfg.userAgentSuffix}`
    : USER_AGENT_BASE;

  const limiter = new PerHostRateLimiter(cfg.perHostQps, clock);
  const robotsCache = new Map<string, RobotsRules>();

  const frontier: FrontierItem[] = [{ url: opts.entryUrl, depth: 0 }];
  const seen = new Set<string>();
  const collapsed = new Map<string, SiteMapPage>();
  const skipped: SkippedEntry[] = [];

  let fetched = 0;
  let exitReason: CrawlExitReason = "done";

  const session = await launchBrowser({
    headless: true,
    storageState: opts.storageStatePath,
    viewport: { width: 1280, height: 800 },
    navigationTimeoutMs: 30_000,
  });
  await session.context.setExtraHTTPHeaders({ "user-agent": userAgent });

  const deadlineMs = cfg.timeoutMs > 0 ? clock.now() + cfg.timeoutMs : 0;

  try {
    while (frontier.length > 0) {
      if (opts.signal?.aborted) {
        exitReason = "aborted";
        break;
      }
      if (deadlineMs && clock.now() >= deadlineMs) {
        exitReason = "timeoutReached";
        break;
      }
      if (fetched >= cfg.maxPages) {
        exitReason = "maxPagesReached";
        break;
      }

      const item = frontier.shift()!;
      const normalized = safeNormalize(item.url, cfg);
      if (!normalized) {
        skipped.push({ url: item.url, reason: "fetch-error", detail: "bad URL" });
        continue;
      }
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      if (item.depth > cfg.maxDepth) {
        skipped.push({ url: normalized, reason: "depth-budget" });
        continue;
      }

      if (!isWithinScope(opts.entryUrl, normalized, cfg)) {
        skipped.push({ url: normalized, reason: "out-of-scope" });
        continue;
      }

      // Robots
      if (!cfg.ignoreRobots) {
        const host = new URL(normalized).origin;
        let rules = robotsCache.get(host);
        if (!rules) {
          rules = await fetchRobots(host, { timeoutMs: 5000 });
          robotsCache.set(host, rules);
        }
        const p = new URL(normalized).pathname || "/";
        if (!isAllowed(rules, p, USER_AGENT_BASE)) {
          skipped.push({ url: normalized, reason: "robots-disallow" });
          continue;
        }
      }

      // Rate limit per host
      const host = registrableDomainOf(normalized);
      await limiter.take(host);

      const fetchedAt = new Date().toISOString();
      let status = 0;
      let title: string | undefined;
      let links: string[] = [];
      try {
        const response = await session.page.goto(normalized, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        status = response?.status() ?? 0;
        const contentType = response?.headers()["content-type"] ?? "";
        if (!contentType.includes("html")) {
          skipped.push({ url: normalized, reason: "non-html", detail: contentType });
          continue;
        }
        title = await session.page.title();
        links = await extractLinks(session.page);
      } catch (err) {
        skipped.push({
          url: normalized,
          reason: "fetch-error",
          detail: (err as Error).message.slice(0, 200),
        });
        continue;
      }

      fetched++;
      const collapsedKey = collapseRoute(normalized, cfg.routePatterns);
      const existing = collapsed.get(collapsedKey.key);
      if (existing) {
        existing.occurrences += 1;
      } else {
        const entry: SiteMapPage = {
          url: normalized,
          normalizedUrl: normalized,
          routePattern:
            collapsedKey.pattern === new URL(normalized).pathname
              ? undefined
              : collapsedKey.pattern,
          sampleUrl: normalized,
          title: title || undefined,
          status,
          depth: item.depth,
          capturedAt: fetchedAt,
          occurrences: 1,
        };
        collapsed.set(collapsedKey.key, entry);
      }

      // Enqueue children
      if (item.depth < cfg.maxDepth) {
        for (const href of links) {
          try {
            const absolute = new URL(href, normalized).toString();
            const norm = safeNormalize(absolute, cfg);
            if (!norm || seen.has(norm)) continue;
            if (!isWithinScope(opts.entryUrl, norm, cfg)) continue;
            frontier.push({ url: norm, depth: item.depth + 1 });
          } catch {
            /* ignore malformed href */
          }
        }
      }
    }

    if (frontier.length > 0 && exitReason === "done") {
      // We exited the loop for a budget reason already encoded above;
      // if frontier still has items but loop ended cleanly, the budgets caught it.
    }
  } finally {
    await session.close();
  }

  const finishedAt = new Date().toISOString();
  const pages = [...collapsed.values()];
  const siteMap: SiteMap = {
    crawlId,
    entryUrl: opts.entryUrl,
    startedAt,
    finishedAt,
    exitReason,
    totals: {
      fetched,
      skipped: skipped.length,
      unique: pages.length,
    },
    pages,
    skipped,
    config: cfg,
    storageStatePath: opts.storageStatePath,
  };

  // Persist
  const sitemapDir = path.join("reports", "sitemaps");
  await mkdir(sitemapDir, { recursive: true });
  await writeFile(
    path.join(sitemapDir, `${crawlId}.json`),
    JSON.stringify(siteMap, null, 2),
  );

  return siteMap;
}

function safeNormalize(url: string, cfg: CrawlConfig): string | null {
  try {
    return normalizeUrl(url, { ignoreParams: cfg.ignoreParams });
  } catch {
    return null;
  }
}

function isWithinScope(entry: string, candidate: string, cfg: CrawlConfig): boolean {
  if (cfg.includeSubdomains) return sameRegistrableDomain(entry, candidate);
  return sameOrigin(entry, candidate);
}

async function extractLinks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"))
      .map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "")
      .filter(Boolean),
  );
}

export function generateCrawlId(): string {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  return `C-${stamp}-${randomBytes(2).toString("hex")}`;
}

/** Tag used in evidence paths so per-page artefacts have stable names. */
export function pageEvidenceKey(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 10);
}

// Surface skipped reasons enum for callers that want it.
export type { SkippedReason };
