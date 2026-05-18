import { createHash } from "node:crypto";

/**
 * Tiny seeded test-data generator. Not as rich as faker.js, but
 * dependency-free, deterministic per (seed + field), and aware of
 * locale conventions for a small set of high-value field types.
 *
 * `seed` is typically `${runId}::${scenarioId}::${stepIndex}` so the
 * same scenario generates the same values across reruns.
 *
 * Anti-harvest: callers pass `forbidden` (a snapshot of strings observed
 * in the live PageAnalysis) and we re-roll if a candidate collides.
 */

export interface GenerateValueOpts {
  fieldName: string;
  fieldType?: string; // input type attribute, lowercase
  locale?: string;    // 'en', 'vi', 'ja', …
  seed: string;
  forbidden?: Set<string>;
}

export function generateValue(opts: GenerateValueOpts): string {
  const heuristic = inferHeuristic(opts.fieldName, opts.fieldType);
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = renderHeuristic(heuristic, opts.locale ?? "en", `${opts.seed}#${attempt}`);
    if (!opts.forbidden || !opts.forbidden.has(candidate)) return candidate;
  }
  // Fall back to a non-colliding numeric tail.
  return `${renderHeuristic(heuristic, opts.locale ?? "en", opts.seed)}-${Date.now()}`;
}

type Heuristic =
  | "email"
  | "phone"
  | "name"
  | "username"
  | "password"
  | "address"
  | "zip"
  | "city"
  | "country"
  | "company"
  | "url"
  | "date"
  | "number"
  | "search"
  | "text";

function inferHeuristic(name: string, type: string | undefined): Heuristic {
  const n = `${name} ${type ?? ""}`.toLowerCase();
  if (type === "email" || /email|e-mail/.test(n)) return "email";
  if (type === "tel" || /phone|tel|mobile/.test(n)) return "phone";
  if (type === "password" || /password|passcode/.test(n)) return "password";
  if (type === "url" || /url|website|homepage/.test(n)) return "url";
  if (type === "date" || /date|birthday|dob/.test(n)) return "date";
  if (type === "number" || /age|count|qty|amount/.test(n)) return "number";
  if (type === "search" || /search|query/.test(n)) return "search";
  if (/first.*name|given/.test(n)) return "name";
  if (/last.*name|family|surname/.test(n)) return "name";
  if (/full.*name|^name$/.test(n)) return "name";
  if (/user(name)?|account|login/.test(n)) return "username";
  if (/address|street/.test(n)) return "address";
  if (/zip|postcode|postal/.test(n)) return "zip";
  if (/city|town/.test(n)) return "city";
  if (/country|nation/.test(n)) return "country";
  if (/company|org|employer/.test(n)) return "company";
  return "text";
}

const LOCALES = {
  en: {
    firstNames: ["Alice", "Bob", "Carol", "David", "Eva", "Frank", "Gina"],
    lastNames: ["Nguyen", "Tran", "Le", "Pham", "Hoang", "Vu", "Do"],
    emailDomain: "example.com",
    phonePrefix: "+1-555",
    city: ["Springfield", "Lakeside", "Hilltown", "Riverdale"],
    country: "United States",
  },
  vi: {
    firstNames: ["An", "Binh", "Chi", "Dung", "Hanh", "Khoa", "Lan"],
    lastNames: ["Nguyen", "Tran", "Le", "Pham", "Hoang", "Vu", "Do"],
    emailDomain: "example.vn",
    phonePrefix: "+84-90",
    city: ["Ha Noi", "Sai Gon", "Da Nang", "Hue"],
    country: "Viet Nam",
  },
  ja: {
    firstNames: ["Akira", "Haru", "Yuki", "Ren", "Sora", "Aoi"],
    lastNames: ["Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe"],
    emailDomain: "example.jp",
    phonePrefix: "+81-90",
    city: ["Tokyo", "Osaka", "Kyoto", "Sapporo"],
    country: "Japan",
  },
} as const;

function renderHeuristic(h: Heuristic, locale: string, seed: string): string {
  const L = LOCALES[locale as keyof typeof LOCALES] ?? LOCALES.en;
  const r = rng(seed);

  switch (h) {
    case "name": {
      return `${pick(L.firstNames, r)} ${pick(L.lastNames, r)}`;
    }
    case "username": {
      const f = pick(L.firstNames, r).toLowerCase();
      const l = pick(L.lastNames, r).toLowerCase();
      return `${f}.${l}${(r() * 100) | 0}`;
    }
    case "email": {
      const u = renderHeuristic("username", locale, `${seed}#u`);
      return `${u}@${L.emailDomain}`;
    }
    case "phone": {
      const n = ((r() * 9_999_999) | 0).toString().padStart(7, "0");
      return `${L.phonePrefix}-${n.slice(0, 3)}-${n.slice(3)}`;
    }
    case "password":
      // Strong-enough placeholder that doesn't leak in screenshots
      return "Test-Pass-1234!";
    case "address":
      return `${(r() * 999) | 0} Test St`;
    case "zip":
      return `${1000 + ((r() * 89_999) | 0)}`;
    case "city":
      return pick(L.city, r);
    case "country":
      return L.country;
    case "company":
      return `${pick(L.lastNames, r)} Co.`;
    case "url":
      return `https://${L.emailDomain}/${(r() * 1e6).toString(36).slice(0, 6)}`;
    case "date":
      // 2010-2025
      return `${2010 + ((r() * 16) | 0)}-${pad2(1 + ((r() * 12) | 0))}-${pad2(1 + ((r() * 28) | 0))}`;
    case "number":
      return `${(r() * 100) | 0}`;
    case "search":
      return `search-${seed.slice(-6)}`;
    case "text":
    default:
      return `test-${seed.slice(-6)}`;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pick<T>(arr: readonly T[], r: () => number): T {
  return arr[(r() * arr.length) | 0]!;
}

/** Tiny deterministic PRNG (mulberry32) seeded from a sha1 of the input. */
function rng(seed: string): () => number {
  const h = createHash("sha1").update(seed).digest();
  let a = h.readUInt32BE(0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
