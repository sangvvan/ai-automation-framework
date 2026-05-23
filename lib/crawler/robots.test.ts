import { describe, expect, it } from "vitest";
import { isAllowed, parseRobotsTxt } from "./robots";

describe("parseRobotsTxt", () => {
  it("parses a simple disallow", () => {
    const r = parseRobotsTxt(`User-agent: *\nDisallow: /admin`);
    expect(isAllowed(r, "/admin/users", "ai-test")).toBe(false);
    expect(isAllowed(r, "/about", "ai-test")).toBe(true);
  });

  it("longest-prefix wins", () => {
    const r = parseRobotsTxt(
      `User-agent: *\nDisallow: /api\nAllow: /api/public`,
    );
    expect(isAllowed(r, "/api/private", "ai-test")).toBe(false);
    expect(isAllowed(r, "/api/public/foo", "ai-test")).toBe(true);
  });

  it("agent-specific rules win over wildcard", () => {
    const r = parseRobotsTxt(`
User-agent: *
Disallow: /

User-agent: ai-test
Allow: /
`);
    expect(isAllowed(r, "/home", "ai-test")).toBe(true);
    expect(isAllowed(r, "/home", "Googlebot")).toBe(false);
  });

  it("empty Disallow means allow everything", () => {
    const r = parseRobotsTxt(`User-agent: *\nDisallow:`);
    expect(isAllowed(r, "/anything", "ai-test")).toBe(true);
  });

  it("ignores comments", () => {
    const r = parseRobotsTxt(`# nothing here\nUser-agent: *\nDisallow: /x # block`);
    expect(isAllowed(r, "/x/a", "ai-test")).toBe(false);
  });
});
