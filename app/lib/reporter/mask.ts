import type { RunSummary } from "../validation";

const DEFAULT_MASK = "***";
const SENSITIVE_KEYS = ["password", "token", "secret", "ssn", "card", "card_number", "cvv"];

export interface MaskOptions {
  maskKeys?: string[];
  mask?: string;
}

export function maskRunSummary(summary: RunSummary, opts: MaskOptions = {}): RunSummary {
  const keys = new Set([...(opts.maskKeys ?? []), ...SENSITIVE_KEYS].map((k) => k.toLowerCase()));
  const mask = opts.mask ?? DEFAULT_MASK;
  return JSON.parse(
    JSON.stringify(summary, (_k, v) => {
      // Sensitive fill values: replace based on locator path semantics
      if (
        v &&
        typeof v === "object" &&
        "keyword" in v &&
        v.keyword === "fill" &&
        typeof v.value === "string"
      ) {
        const target = v.target;
        const name =
          (target && (target.text ?? target.name ?? target.value)) ?? "";
        const lower = String(name).toLowerCase();
        if ([...keys].some((k) => lower.includes(k))) {
          return { ...v, value: mask };
        }
      }
      return v;
    }),
  ) as RunSummary;
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
