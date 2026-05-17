import { describe, expect, it } from "vitest";
import { CrawlConfig, SiteMap, SiteMapPage } from "./sitemap";

describe("CrawlConfig", () => {
  it("applies sensible defaults", () => {
    const c = CrawlConfig.parse({});
    expect(c.maxPages).toBe(25);
    expect(c.perHostQps).toBe(2);
    expect(c.ignoreParams).toContain("utm_source");
  });

  it("rejects negative depth", () => {
    expect(() => CrawlConfig.parse({ maxDepth: -1 })).toThrow();
  });
});

describe("SiteMapPage", () => {
  it("requires an absolute URL", () => {
    expect(() =>
      SiteMapPage.parse({
        url: "/relative",
        normalizedUrl: "/relative",
        status: 200,
        depth: 0,
        capturedAt: "2026-05-17T10:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("SiteMap", () => {
  it("accepts a minimal sitemap", () => {
    const sm = SiteMap.parse({
      crawlId: "C-1",
      entryUrl: "https://example.com",
      startedAt: "2026-05-17T10:00:00.000Z",
      finishedAt: "2026-05-17T10:00:30.000Z",
      exitReason: "done",
      totals: { fetched: 1, skipped: 0, unique: 1 },
      pages: [
        {
          url: "https://example.com/",
          normalizedUrl: "https://example.com/",
          status: 200,
          depth: 0,
          capturedAt: "2026-05-17T10:00:01.000Z",
        },
      ],
      config: {},
    });
    expect(sm.pages).toHaveLength(1);
    expect(sm.skipped).toEqual([]);
  });

  it("rejects unknown exit reason", () => {
    expect(() =>
      SiteMap.parse({
        crawlId: "C",
        entryUrl: "https://x",
        startedAt: "2026-05-17T10:00:00.000Z",
        finishedAt: "2026-05-17T10:00:01.000Z",
        exitReason: "nuked",
        totals: { fetched: 0, skipped: 0, unique: 0 },
        pages: [],
        config: {},
      }),
    ).toThrow();
  });
});
