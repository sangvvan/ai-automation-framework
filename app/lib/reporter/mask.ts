import type { RunSummary } from "../validation";

const DEFAULT_MASK = "***";
const SENSITIVE_KEYS = ["password", "token", "secret", "ssn", "card", "card_number", "cvv"];

export interface MaskOptions {
  maskKeys?: string[];
  mask?: string;
}

interface Locatorish {
  text?: string;
  name?: string;
  value?: string;
}

function sensitiveTargetName(target: unknown, keys: Set<string>): string | null {
  if (!target || typeof target !== "object") return null;
  const t = target as Locatorish;
  const name = (t.text ?? t.name ?? t.value ?? "").toString().toLowerCase();
  for (const k of keys) {
    if (name.includes(k)) return name;
  }
  return null;
}

export function maskRunSummary(summary: RunSummary, opts: MaskOptions = {}): RunSummary {
  const keys = new Set([...(opts.maskKeys ?? []), ...SENSITIVE_KEYS].map((k) => k.toLowerCase()));
  const mask = opts.mask ?? DEFAULT_MASK;

  // Pass 1: collect raw values from any fill action whose target is sensitive.
  // We'll redact these literal substrings everywhere in the JSON (description
  // strings, expected results, defect bodies, etc.) so the cleartext never
  // leaks through the report.
  const literals = new Set<string>();
  walk(summary, (node) => {
    if (
      node &&
      typeof node === "object" &&
      (node as { keyword?: string }).keyword === "fill" &&
      typeof (node as { value?: unknown }).value === "string"
    ) {
      const sensitive = sensitiveTargetName((node as { target?: unknown }).target, keys);
      if (sensitive) {
        const v = (node as { value: string }).value;
        if (v && v !== mask) literals.add(v);
      }
    }
  });

  // Pass 2: serialise with replacer that masks the fill value field plus any
  // string containing a known sensitive literal.
  const stringReplacer = (s: string) => {
    let out = s;
    for (const lit of literals) {
      if (lit.length === 0) continue;
      const re = new RegExp(escapeRegex(lit), "g");
      out = out.replace(re, mask);
    }
    return out;
  };

  return JSON.parse(
    JSON.stringify(summary, (_k, v) => {
      if (typeof v === "string") return stringReplacer(v);
      if (
        v &&
        typeof v === "object" &&
        "keyword" in v &&
        v.keyword === "fill" &&
        typeof v.value === "string"
      ) {
        if (sensitiveTargetName(v.target, keys)) {
          return { ...v, value: mask };
        }
      }
      return v;
    }),
  ) as RunSummary;
}

function walk(value: unknown, visit: (node: unknown) => void): void {
  visit(value);
  if (Array.isArray(value)) {
    for (const v of value) walk(v, visit);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) walk(v, visit);
  }
}

export function maskString(s: string, keys: string[]): string {
  let out = s;
  for (const k of keys) {
    const re = new RegExp(`(${escapeRegex(k)}\\s*[=:]\\s*)([^\\s,;]+)`, "ig");
    out = out.replace(re, `$1${DEFAULT_MASK}`);
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
