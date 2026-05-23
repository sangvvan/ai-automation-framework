import type { SecurityCheck, ValidationCheck } from "../../../validation";

export interface SecurityHeaderInput {
  /** Headers as returned by Playwright's Response.headers(). */
  headers: Record<string, string>;
  url: string;
  cookies?: { name: string; secure?: boolean; httpOnly?: boolean; sameSite?: string }[];
}

export interface SecurityHeaderResult {
  checks: SecurityCheck[];
  validationChecks: ValidationCheck[];
}

const REQUIRED_HEADERS: {
  name: string;
  alternativeKey?: string;
  severity: SecurityCheck["severity"];
  validator?: (value: string) => boolean;
  hint?: string;
}[] = [
  {
    name: "content-security-policy",
    severity: "high",
    hint: "Define a CSP to mitigate XSS.",
  },
  {
    name: "strict-transport-security",
    severity: "high",
    validator: (v) => /max-age=\d+/.test(v),
    hint: "Set HSTS with max-age.",
  },
  {
    name: "x-frame-options",
    alternativeKey: "content-security-policy:frame-ancestors",
    severity: "med",
    hint: "Set X-Frame-Options or CSP frame-ancestors to prevent clickjacking.",
  },
  {
    name: "x-content-type-options",
    severity: "low",
    validator: (v) => /nosniff/i.test(v),
    hint: "Set X-Content-Type-Options: nosniff.",
  },
  {
    name: "referrer-policy",
    severity: "low",
    hint: "Set Referrer-Policy to limit referer leakage.",
  },
];

export function validateSecurityHeaders(input: SecurityHeaderInput): SecurityHeaderResult {
  const headers = Object.fromEntries(
    Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const isHttps = input.url.startsWith("https://");
  const checks: SecurityCheck[] = [];

  for (const r of REQUIRED_HEADERS) {
    // HSTS only meaningful over HTTPS — skip on http
    if (r.name === "strict-transport-security" && !isHttps) continue;

    const present = headers[r.name];
    let alternativeOk = false;
    if (!present && r.alternativeKey) {
      const [altHeader, directive] = r.alternativeKey.split(":");
      const altValue = headers[altHeader];
      if (altValue && directive && altValue.toLowerCase().includes(directive)) {
        alternativeOk = true;
      }
    }
    if (!present && !alternativeOk) {
      checks.push({
        name: r.name,
        status: "warn",
        detail: r.hint,
        severity: r.severity,
      });
      continue;
    }
    if (present && r.validator && !r.validator(present)) {
      checks.push({
        name: r.name,
        status: "warn",
        detail: `Header set but value '${present.slice(0, 60)}' looks weak`,
        severity: r.severity,
      });
      continue;
    }
    checks.push({ name: r.name, status: "passed", severity: r.severity });
  }

  // Cookies
  for (const c of input.cookies ?? []) {
    const issues: string[] = [];
    if (isHttps && c.secure === false) issues.push("missing Secure flag");
    if (c.httpOnly === false) issues.push("missing HttpOnly flag");
    if (!c.sameSite) issues.push("missing SameSite");
    if (issues.length > 0) {
      checks.push({
        name: `cookie:${c.name}`,
        status: "warn",
        detail: issues.join(", "),
        severity: "med",
      });
    }
  }

  const validationChecks: ValidationCheck[] = checks.map((c) => ({
    name: c.name,
    status: c.status,
    detail: c.detail,
    category: "security",
  }));

  return { checks, validationChecks };
}
