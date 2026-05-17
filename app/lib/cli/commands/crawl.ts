import path from "node:path";
import { loadConfig } from "../../config";
import { flagBool, flagString } from "../args";
import type { CliCommand } from "../commands";
import { discoverSiteMap } from "../../crawler/discover";
import { CrawlConfig } from "../../validation/sitemap";
import { crawlsRepo } from "../../db/crawls";

export const crawlCommand: CliCommand = {
  help: {
    name: "crawl",
    summary: "Discover reachable pages from an entry URL and produce a SiteMap.",
    example: "ai-test crawl --url https://example.com --max-pages 25",
    options: [
      { flag: "--url", description: "Entry URL (required)" },
      { flag: "--max-pages", description: "Max pages to fetch", default: "25" },
      { flag: "--max-depth", description: "BFS depth budget", default: "3" },
      { flag: "--max-concurrency", description: "Parallel fetches", default: "2" },
      { flag: "--per-host-qps", description: "Per-host requests per second", default: "2" },
      { flag: "--include-subdomains", description: "Follow subdomains (boolean)" },
      { flag: "--ignore-robots", description: "Override robots.txt (boolean)" },
      { flag: "--auth-recipe", description: "Path to a YAML auth recipe (REQ-010)" },
      { flag: "--storage-state", description: "Path to a Playwright storage-state.json" },
      { flag: "--output-dir", description: "Override reports root" },
    ],
  },
  run: async (args) => {
    const url = flagString(args, "url");
    if (!url) {
      process.stderr.write("Missing --url\n");
      return 1;
    }
    const cfg = loadConfig();

    const crawlConfig = CrawlConfig.parse({
      maxPages: numOpt(flagString(args, "max-pages")),
      maxDepth: numOpt(flagString(args, "max-depth")),
      maxConcurrency: numOpt(flagString(args, "max-concurrency")),
      perHostQps: numOpt(flagString(args, "per-host-qps")),
      includeSubdomains: flagBool(args, "include-subdomains"),
      ignoreRobots: flagBool(args, "ignore-robots"),
    });

    let storageStatePath = flagString(args, "storage-state");

    // --auth-recipe implies running a login flow first; defer to
    // executeAuthRecipe (REQ-010) when implemented. For now, surface a
    // clear message rather than silently ignore.
    if (flagString(args, "auth-recipe") && !storageStatePath) {
      try {
        const { runAuthRecipe } = await import("../../auth/execute-auth");
        const res = await runAuthRecipe({
          recipePath: flagString(args, "auth-recipe")!,
        });
        storageStatePath = res.storageStatePath;
        process.stdout.write(`Auth: storageState saved to ${storageStatePath}\n`);
      } catch (err) {
        process.stderr.write(`Auth recipe failed: ${(err as Error).message}\n`);
        return 3;
      }
    }

    const sm = await discoverSiteMap({
      entryUrl: url,
      config: crawlConfig,
      storageStatePath,
    });

    const sitemapPath = path.join("reports", "sitemaps", `${sm.crawlId}.json`);
    await crawlsRepo.insert(sm, sitemapPath).catch((err) => {
      process.stderr.write(
        `Note: DB persistence skipped (${(err as Error).message}).\n`,
      );
    });

    process.stdout.write(
      `\n✓ Crawl ${sm.crawlId} — fetched=${sm.totals.fetched} unique=${sm.totals.unique} skipped=${sm.totals.skipped} (exit: ${sm.exitReason})\n`,
    );
    process.stdout.write(`SiteMap: ${sitemapPath}\n`);
    return 0;

    void cfg; // reserved for future per-config use
  },
};

function numOpt(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
