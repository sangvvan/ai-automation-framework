---
id: ADR-006
title: Crawler topology, politeness, and route-pattern dedupe
status: accepted
date: 2026-05-17
deciders: planning agent
---

# ADR-006 — Crawler topology

## Context
REQ-009 requires discovering reachable pages from a single entry URL,
bounded, polite, robots-aware. The crawler must reuse the existing
Playwright stack and play well with REQ-010 (storageState).

## Decision

### Engine
- **In-process, breadth-first, single Playwright `BrowserContext` per
  crawl** (the context carries storageState from REQ-010).
- One worker pool with configurable `maxConcurrency` (default 2),
  per-host token-bucket throttle keyed by registrable domain.
- Crawl driven from a `Frontier` (priority queue keyed by depth +
  discovery order) and a `Seen` set keyed by `normalizedUrl`.

### URL normalization
- Lowercase scheme + host.
- Strip default ports, trailing slash, hash fragments.
- Sort query params; drop tracking params (`utm_*`, `gclid`, `fbclid`).
- Configurable `ignoreParams` allowlist.

### Route pattern collapse
- After normalization, attempt to derive a route pattern by replacing
  path segments that match `^\d+$` or UUID-shape with `:id` / `:uuid`,
  and `[a-f0-9]{8,}` with `:slug`.
- Pages sharing a route pattern collapse to one `SiteMapPage` entry
  with `sampleUrl` and `occurrences: N`.
- Configurable patterns in `framework.config.yaml`
  (`crawler.routePatterns: [{ regex, replacement }]`).

### Robots
- Fetch `/robots.txt` on first request to a host; parse with a tiny
  built-in parser (no new dep). Cache per host for the crawl lifetime.
- `--ignore-robots` flag sets `robotsBypass: true` in audit metadata.

### Politeness
- Per-host QPS via token bucket (`crawler.perHostQps`, default 2).
- Global concurrency cap (`crawler.maxConcurrency`, default 2).
- Identifying `User-Agent` header: `ai-test/<version> (+repo URL)`.

### Storage
- `reports/sitemaps/{crawl-id}.json` — full SiteMap.
- DB table `crawls` (id, entry_url, started_at, finished_at,
  exit_reason, totals_json, sitemap_path).

## Consequences
- Single-process, simple to reason about; not horizontally scalable yet.
- Route patterns are heuristic; reviewer can override in the Plan.
- Per-host throttling is naive but adequate for staging environments.

## Alternatives considered
- Use an external crawler (Apify / crawlee) — rejected: bloat, license,
  duplicates Playwright already in stack.
- Sitemap.xml only — rejected: most apps don't expose it usefully.
- Headless-API discovery from OpenAPI — out of scope for UI testing.
