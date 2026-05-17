/**
 * Tiny robots.txt parser — sufficient for the crawler's needs (User-agent
 * matching + Disallow/Allow rules). No Crawl-delay, no Sitemap directive
 * support yet (sitemap.xml ingestion is a future enhancement).
 *
 * Reference: https://www.rfc-editor.org/rfc/rfc9309
 */

export interface RobotsRules {
  /** Lower-cased agent → rules sorted longest-prefix-first. */
  byAgent: Map<string, Rule[]>;
}

interface Rule {
  kind: "allow" | "disallow";
  pattern: string;
}

export function parseRobotsTxt(text: string): RobotsRules {
  const byAgent = new Map<string, Rule[]>();
  let currentAgents: string[] = [];
  // robots.txt groups: blank line ends a group, but many real-world
  // files chain `User-agent:` lines without separators. We accumulate.
  let pendingNewGroup = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) {
      if (currentAgents.length) pendingNewGroup = true;
      continue;
    }
    const [field, ...rest] = line.split(":");
    if (!field || rest.length === 0) continue;
    const key = field.toLowerCase().trim();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      if (pendingNewGroup) {
        currentAgents = [];
        pendingNewGroup = false;
      }
      currentAgents.push(value.toLowerCase());
      continue;
    }
    if (key === "disallow" || key === "allow") {
      if (!currentAgents.length) continue;
      for (const ua of currentAgents) {
        const list = byAgent.get(ua) ?? [];
        list.push({ kind: key as "allow" | "disallow", pattern: value });
        byAgent.set(ua, list);
      }
      pendingNewGroup = false;
    }
  }
  // Sort by pattern length descending — longest match wins.
  for (const rules of byAgent.values()) {
    rules.sort((a, b) => b.pattern.length - a.pattern.length);
  }
  return { byAgent };
}

/**
 * Returns true when `path` is allowed for `agent` under the rules.
 * Pattern semantics: prefix match against the path. Empty Disallow
 * means everything allowed.
 */
export function isAllowed(rules: RobotsRules, path: string, agent: string): boolean {
  const candidates = [agent.toLowerCase(), "*"];
  for (const ua of candidates) {
    const list = rules.byAgent.get(ua);
    if (!list) continue;
    for (const rule of list) {
      if (!rule.pattern) {
        // empty Disallow = allow everything; empty Allow = ignored
        if (rule.kind === "disallow") return true;
        continue;
      }
      if (path.startsWith(rule.pattern)) {
        return rule.kind === "allow";
      }
    }
    // First matching agent group wins per RFC even without a hit.
    return true;
  }
  return true;
}

/** Fetch robots.txt for a host with a sane timeout. */
export async function fetchRobots(
  baseUrl: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<RobotsRules> {
  const url = new URL("/robots.txt", baseUrl).toString();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), init?.timeoutMs ?? 5000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return { byAgent: new Map() };
    const body = await res.text();
    return parseRobotsTxt(body);
  } catch {
    return { byAgent: new Map() };
  } finally {
    clearTimeout(t);
  }
}
