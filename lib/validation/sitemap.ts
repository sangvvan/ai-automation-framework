import { z } from "zod";

export const RoutePatternRule = z.object({
  /** A JS regex (string form) tested against a single path segment. */
  regex: z.string().min(1),
  /** Replacement segment (e.g. `:id`, `:slug`). */
  replacement: z.string().min(1),
});
export type RoutePatternRule = z.infer<typeof RoutePatternRule>;

export const CrawlConfig = z.object({
  maxPages: z.number().int().positive().default(25),
  maxDepth: z.number().int().nonnegative().default(3),
  maxConcurrency: z.number().int().positive().max(16).default(2),
  perHostQps: z.number().positive().default(2),
  includeSubdomains: z.boolean().default(false),
  ignoreRobots: z.boolean().default(false),
  /** Query parameters to drop during URL normalization. */
  ignoreParams: z
    .array(z.string())
    .default(["utm_source", "utm_medium", "utm_campaign", "gclid", "fbclid"]),
  routePatterns: z.array(RoutePatternRule).default([]),
  /** Hard wall-clock budget for the whole crawl, ms. 0 = unlimited. */
  timeoutMs: z.number().int().nonnegative().default(0),
  /** Identifying user agent appended after `ai-test/<version>`. */
  userAgentSuffix: z.string().optional(),
});
export type CrawlConfig = z.infer<typeof CrawlConfig>;

export const SiteMapPage = z.object({
  url: z.string().url(),
  normalizedUrl: z.string().min(1),
  routePattern: z.string().optional(),
  /** Representative URL when several URLs collapsed under one pattern. */
  sampleUrl: z.string().url().optional(),
  title: z.string().optional(),
  status: z.number().int().nonnegative(),
  depth: z.number().int().nonnegative(),
  capturedAt: z.string().datetime({ offset: true }),
  /** Relative path to the per-page PageAnalysis JSON when produced. */
  pageAnalysisPath: z.string().optional(),
  /** Count of URLs collapsed under the same routePattern. */
  occurrences: z.number().int().positive().default(1),
});
export type SiteMapPage = z.infer<typeof SiteMapPage>;

export const SkippedReason = z.enum([
  "robots-disallow",
  "out-of-scope",
  "duplicate",
  "depth-budget",
  "fetch-error",
  "non-html",
  "auth-required",
  "rate-limited",
]);
export type SkippedReason = z.infer<typeof SkippedReason>;

export const SkippedEntry = z.object({
  url: z.string().url(),
  reason: SkippedReason,
  detail: z.string().optional(),
});
export type SkippedEntry = z.infer<typeof SkippedEntry>;

export const CrawlExitReason = z.enum([
  "done",
  "maxPagesReached",
  "maxDepthReached",
  "timeoutReached",
  "aborted",
]);
export type CrawlExitReason = z.infer<typeof CrawlExitReason>;

export const SiteMap = z.object({
  crawlId: z.string().min(1),
  entryUrl: z.string().url(),
  startedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }),
  exitReason: CrawlExitReason,
  totals: z.object({
    fetched: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    unique: z.number().int().nonnegative(),
  }),
  pages: z.array(SiteMapPage),
  skipped: z.array(SkippedEntry).default([]),
  config: CrawlConfig,
  /** Optional: storage-state path produced by auth flow (REQ-010). */
  storageStatePath: z.string().optional(),
});
export type SiteMap = z.infer<typeof SiteMap>;
