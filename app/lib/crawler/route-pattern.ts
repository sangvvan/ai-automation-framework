import type { RoutePatternRule } from "../validation/sitemap";

/**
 * Collapse a URL path into a route pattern by replacing volatile segments
 * (numbers, UUIDs, long hex slugs) with placeholders, plus any
 * user-supplied rules.
 *
 * Returns the canonical pattern key (host + pattern path), and the
 * pattern path alone.
 */
export interface CollapseResult {
  key: string;
  pattern: string;
}

const BUILTIN_RULES: RoutePatternRule[] = [
  { regex: "^\\d+$", replacement: ":id" },
  {
    regex: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    replacement: ":uuid",
  },
  { regex: "^[a-f0-9]{8,}$", replacement: ":slug" },
];

export function collapseRoute(url: string, extra: RoutePatternRule[] = []): CollapseResult {
  const u = new URL(url);
  // User-supplied rules win over built-ins on first match.
  const rules = [...extra, ...BUILTIN_RULES].map((r) => ({
    re: new RegExp(r.regex),
    replacement: r.replacement,
  }));
  const segments = u.pathname.split("/").map((seg) => {
    if (!seg) return seg;
    for (const { re, replacement } of rules) {
      if (re.test(seg)) return replacement;
    }
    return seg;
  });
  const pattern = segments.join("/") || "/";
  return {
    key: `${u.protocol}//${u.host}${pattern}`,
    pattern,
  };
}
