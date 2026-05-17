/**
 * URL normalization for the crawler.
 *
 * Goal: collapse functionally-equivalent URLs to one canonical string so
 * the frontier `Seen` set works correctly and tracking params don't
 * inflate the SiteMap.
 */

const DEFAULT_PORTS: Record<string, string> = {
  "http:": "80",
  "https:": "443",
};

const DEFAULT_TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
];

export interface NormalizeOptions {
  /** Drop these query keys in addition to the built-in defaults. */
  ignoreParams?: string[];
  /** When true, keep trailing slash on path; default false (strip). */
  keepTrailingSlash?: boolean;
}

export function normalizeUrl(raw: string, opts: NormalizeOptions = {}): string {
  const u = new URL(raw);
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  if (u.port && DEFAULT_PORTS[u.protocol] === u.port) u.port = "";
  u.hash = "";

  const ignore = new Set(
    [...(opts.ignoreParams ?? []), ...DEFAULT_TRACKING_PARAMS].map((k) => k.toLowerCase()),
  );

  const kept: [string, string][] = [];
  for (const [k, v] of u.searchParams.entries()) {
    if (ignore.has(k.toLowerCase())) continue;
    kept.push([k, v]);
  }
  kept.sort(([a], [b]) => a.localeCompare(b));
  // rebuild querystring deterministically
  u.search = "";
  for (const [k, v] of kept) u.searchParams.append(k, v);

  // path
  let path = u.pathname || "/";
  if (!opts.keepTrailingSlash && path.length > 1 && path.endsWith("/")) {
    path = path.replace(/\/+$/, "");
  }
  u.pathname = path;

  return u.toString();
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.protocol === ub.protocol && ua.host === ub.host;
  } catch {
    return false;
  }
}

export function sameRegistrableDomain(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    if (ua.protocol !== ub.protocol) return false;
    // Heuristic: same last two labels (e.g. example.com == app.example.com).
    const ta = ua.hostname.split(".").slice(-2).join(".");
    const tb = ub.hostname.split(".").slice(-2).join(".");
    return ta === tb;
  } catch {
    return false;
  }
}

export function registrableDomainOf(rawUrl: string): string {
  const h = new URL(rawUrl).hostname;
  return h.split(".").slice(-2).join(".");
}
