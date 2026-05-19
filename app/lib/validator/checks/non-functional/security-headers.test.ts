import { describe, expect, it } from "vitest";
import { validateSecurityHeaders } from "./security-headers";

describe("validateSecurityHeaders", () => {
  it("warns when CSP is missing", () => {
    const { checks } = validateSecurityHeaders({
      headers: { "x-content-type-options": "nosniff" },
      url: "https://x",
    });
    expect(checks.find((c) => c.name === "content-security-policy")?.status).toBe("warn");
  });

  it("passes when all required headers are set", () => {
    const { checks } = validateSecurityHeaders({
      headers: {
        "content-security-policy": "default-src 'self'",
        "strict-transport-security": "max-age=31536000",
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
      url: "https://x",
    });
    expect(checks.every((c) => c.status === "passed")).toBe(true);
  });

  it("accepts frame-ancestors CSP as alternative to X-Frame-Options", () => {
    const { checks } = validateSecurityHeaders({
      headers: {
        "content-security-policy": "frame-ancestors 'none'",
      },
      url: "https://x",
    });
    expect(checks.find((c) => c.name === "x-frame-options")?.status).toBe("passed");
  });

  it("skips HSTS on plain HTTP", () => {
    const { checks } = validateSecurityHeaders({
      headers: {},
      url: "http://x",
    });
    expect(checks.find((c) => c.name === "strict-transport-security")).toBeUndefined();
  });

  it("flags insecure cookies on HTTPS", () => {
    const { checks } = validateSecurityHeaders({
      headers: { "content-security-policy": "default-src 'self'" },
      url: "https://x",
      cookies: [{ name: "sid", secure: false, httpOnly: false }],
    });
    expect(checks.find((c) => c.name === "cookie:sid")?.status).toBe("warn");
  });
});
