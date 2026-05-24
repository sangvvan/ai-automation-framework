import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// ── ENV ───────────────────────────────────────────────────────────────────
// This is the ONLY file in the codebase that reads process.env.
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),
  BASE_URL: z.preprocess(
    (v) => (typeof v === "string" && v.length > 0 && /^https?:\/\//.test(v) ? v : undefined),
    z.string().url().optional(),
  ),
  DATABASE_URL: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  // AI_TEST_* — runtime overrides for FrameworkConfig fields.
  AI_TEST_BASE_URL: z.string().url().optional(),
  AI_TEST_REPORTS_DIR: z.string().optional(),
  AI_TEST_HEADLESS: z.string().optional(),
  AI_TEST_WORKERS: z.string().optional(),
  AI_TEST_DEFAULT_PROVIDER: z.string().optional(),
  AI_TEST_MAX_SCENARIOS: z.string().optional(),
  // Provider creds (optional in dev/test)
  CLAUDE_API_KEY: z.string().optional(),
  CODEX_API_KEY: z.string().optional(),
  OPENCODE_API_URL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
});

let _env: z.infer<typeof EnvSchema> | null = null;

export function getEnv(): z.infer<typeof EnvSchema> {
  if (_env) return _env;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables:\n${JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)}`,
    );
  }
  _env = parsed.data;
  return _env;
}

// ── FRAMEWORK CONFIG SCHEMA ───────────────────────────────────────────────
export const ViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const RunnerConfig = z.object({
  workers: z.number().int().positive().default(1),
  headless: z.boolean().default(true),
  viewport: ViewportSchema.default({ width: 1280, height: 800 }),
  stepTimeoutMs: z.number().int().positive().default(10000),
  navigationTimeoutMs: z.number().int().positive().default(30000),
  captureScreenshotOnSuccess: z.boolean().default(false),
});

export const GenerationConfig = z.object({
  /** Total functional scenario ceiling per page (legacy). */
  maxScenarios: z.number().int().positive().default(25),
  /**
   * Scenarios per ISTQB technique per page.
   * Preferred over maxScenarios because it gives every technique a fair budget.
   * Default: 3 (Ollama-safe). Raise to 5 for cloud providers.
   */
  scenariosPerTechnique: z.number().int().positive().optional(),
  /** Scenarios per non-functional category (a11y, security, …). Default: 2. */
  scenariosPerNfCategory: z.number().int().positive().optional(),
  categories: z.array(z.string()).default([]),
});

export const ReportConfig = z.object({
  screenshotDiffThreshold: z.number().min(0).max(1).default(0.001),
  maskKeys: z.array(z.string()).default([]),
});

export const TestEnvConfig = z.object({
  allowedHosts: z.array(z.string()).default([]),
  defaultViewport: ViewportSchema.default({ width: 1280, height: 800 }),
});

export const ProviderName = z.enum([
  "claude",
  "codex",
  "gemini",
  "opencode",
  "opencode-ollama",
  "mock",
]);
export type ProviderName = z.infer<typeof ProviderName>;

export const ProviderSpec = z.object({
  enabled: z.boolean().default(false),
  model: z.string().optional(),
  baseUrl: z.string().url().optional(),
  timeoutMs: z.number().int().positive().default(60000),
});

export const AiProviderConfig = z.object({
  defaultProvider: ProviderName,
  providers: z.record(ProviderName, ProviderSpec).default({}),
  fallbackChain: z.record(z.string(), z.array(ProviderName)).default({}),
});

export const FrameworkConfig = z.object({
  baseUrl: z.string().url(),
  reportsDir: z.string().default("reports"),
  testsApprovedDir: z.string().default("tests/approved"),
  testsRegressionDir: z.string().default("tests/regression"),
  testsGeneratedDir: z.string().default("tests/generated"),
  evidenceDir: z.string().default("reports/evidence"),
  runner: RunnerConfig.default({}),
  generation: GenerationConfig.default({}),
  report: ReportConfig.default({}),
  testEnv: TestEnvConfig.default({}),
  ai: AiProviderConfig,
});
export type FrameworkConfig = z.infer<typeof FrameworkConfig>;

// ── LOADER ────────────────────────────────────────────────────────────────
export class ConfigError extends Error {
  constructor(
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

function readYaml(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  try {
    const text = readFileSync(file, "utf8");
    const parsed = parseYaml(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch (err) {
    throw new ConfigError(
      `Failed to parse YAML ${path.basename(file)}: ${(err as Error).message}`,
    );
  }
}

function deepMerge<T extends Record<string, unknown>>(...sources: T[]): T {
  const out: Record<string, unknown> = {};
  for (const src of sources) {
    for (const [k, v] of Object.entries(src ?? {})) {
      if (
        v &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        out[k] &&
        typeof out[k] === "object" &&
        !Array.isArray(out[k])
      ) {
        out[k] = deepMerge(
          out[k] as Record<string, unknown>,
          v as Record<string, unknown>,
        );
      } else if (v !== undefined) {
        out[k] = v;
      }
    }
  }
  return out as T;
}

export interface LoadConfigOptions {
  cwd?: string;
  /** Skip env override (useful for unit tests). */
  skipEnvOverride?: boolean;
}

let _config: FrameworkConfig | null = null;

export function loadConfig(opts: LoadConfigOptions = {}): FrameworkConfig {
  if (_config && !opts.cwd) return _config;
  const cwd = opts.cwd ?? process.cwd();
  const framework = readYaml(path.join(cwd, "configs/framework.config.yaml"));
  const testEnv = readYaml(path.join(cwd, "configs/test-env.yaml"));
  const ai = readYaml(path.join(cwd, "configs/ai-provider.yaml"));

  const merged: Record<string, unknown> = {
    ...framework,
    testEnv,
    ai,
  };

  // Apply env overrides — only this function reads process.env (via getEnv()).
  if (!opts.skipEnvOverride) {
    const env = getEnv();
    if (env.AI_TEST_BASE_URL) merged.baseUrl = env.AI_TEST_BASE_URL;
    if (env.AI_TEST_REPORTS_DIR) merged.reportsDir = env.AI_TEST_REPORTS_DIR;
    if (env.AI_TEST_HEADLESS !== undefined) {
      merged.runner = deepMerge(
        (merged.runner as Record<string, unknown>) ?? {},
        { headless: env.AI_TEST_HEADLESS !== "false" && env.AI_TEST_HEADLESS !== "0" },
      );
    }
    if (env.AI_TEST_WORKERS) {
      merged.runner = deepMerge(
        (merged.runner as Record<string, unknown>) ?? {},
        { workers: Number(env.AI_TEST_WORKERS) },
      );
    }
    if (env.AI_TEST_DEFAULT_PROVIDER) {
      merged.ai = deepMerge(
        (merged.ai as Record<string, unknown>) ?? {},
        { defaultProvider: env.AI_TEST_DEFAULT_PROVIDER },
      );
    }
    if (env.AI_TEST_MAX_SCENARIOS) {
      merged.generation = deepMerge(
        (merged.generation as Record<string, unknown>) ?? {},
        { maxScenarios: Number(env.AI_TEST_MAX_SCENARIOS) },
      );
    }
  }

  const parsed = FrameworkConfig.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ConfigError(`Invalid framework config — ${issues}`, parsed.error.issues);
  }
  if (!opts.cwd) _config = parsed.data;
  return parsed.data;
}

/** For tests: clear cached singletons. */
export function _resetConfigForTests(): void {
  _env = null;
  _config = null;
}
