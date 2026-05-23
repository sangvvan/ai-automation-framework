import { db } from "./client";
import type { SiteMap } from "../validation/sitemap";

export interface CrawlRow {
  id: string;
  entry_url: string;
  started_at: string;
  finished_at: string;
  exit_reason: string;
  totals: unknown;
  sitemap_path: string;
  ignore_robots: boolean;
  include_subdomains: boolean;
  actor_id: string | null;
}

export const crawlsRepo = {
  async insert(
    sm: SiteMap,
    sitemapPath: string,
    actorId: string | null = null,
  ): Promise<void> {
    await db.execute(
      `INSERT INTO crawls (id, entry_url, started_at, finished_at, exit_reason,
                           totals, sitemap_path, ignore_robots, include_subdomains, actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        sm.crawlId,
        sm.entryUrl,
        sm.startedAt,
        sm.finishedAt,
        sm.exitReason,
        JSON.stringify(sm.totals),
        sitemapPath,
        sm.config.ignoreRobots,
        sm.config.includeSubdomains,
        actorId,
      ],
    );
  },
  async findById(id: string): Promise<CrawlRow | null> {
    return db.queryOne<CrawlRow>(
      `SELECT id, entry_url, started_at, finished_at, exit_reason, totals,
              sitemap_path, ignore_robots, include_subdomains, actor_id
         FROM crawls WHERE id = $1`,
      [id],
    );
  },
  async listRecent(limit = 50): Promise<CrawlRow[]> {
    return db.query<CrawlRow>(
      `SELECT id, entry_url, started_at, finished_at, exit_reason, totals,
              sitemap_path, ignore_robots, include_subdomains, actor_id
         FROM crawls ORDER BY started_at DESC LIMIT $1`,
      [limit],
    );
  },
};
