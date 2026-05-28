import { FrameworkConfig, getEnv } from "../config";
import { ClaudeProvider } from "./providers/claude";
import { CodexProvider } from "./providers/codex";
import { OpencodeProvider } from "./providers/opencode";
import { MockProvider } from "./providers/mock";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible";
import type { AiProvider } from "./provider";
import { makeChainedProvider } from "./resolve";
import { fileTracer, noopTracer, type Tracer } from "./trace";

export interface BuildProviderOptions {
  config: FrameworkConfig;
  role: string;
  tracePath?: string;
  /** Hard token budget across all calls on this chain (REQ-017). */
  tokenBudget?: number;
}

export function buildProvider(opts: BuildProviderOptions): AiProvider {
  const cfg = opts.config.ai;
  const chainNames = cfg.fallbackChain?.[opts.role] ?? [cfg.defaultProvider];
  const tracer: Tracer = opts.tracePath ? fileTracer(opts.tracePath) : noopTracer;
  const chain: AiProvider[] = [];
  for (const name of chainNames) {
    const spec = cfg.providers?.[name];
    // mock is always available; other providers must be enabled in YAML.
    if (!spec?.enabled && name !== "mock") continue;
    switch (name) {
      case "claude":
        chain.push(
          new ClaudeProvider({ model: spec?.model, timeoutMs: spec?.timeoutMs }),
        );
        break;
      case "gemini":
        chain.push(
          new OpenAiCompatibleProvider({
            name: "gemini",
            baseUrl: spec?.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta/openai/",
            apiKey: getEnv().GEMINI_API_KEY,
            model: spec?.model ?? "gemini-2.5-flash",
            timeoutMs: spec?.timeoutMs ?? 60000,
            authStyle: "bearer",
          }),
        );
        break;
      case "codex":
        chain.push(
          new CodexProvider({
            model: spec?.model,
            timeoutMs: spec?.timeoutMs,
            baseUrl: spec?.baseUrl,
          }),
        );
        break;
      case "opencode":
        chain.push(
          new OpencodeProvider({
            baseUrl: spec?.baseUrl,
            model: spec?.model,
            timeoutMs: spec?.timeoutMs,
          }),
        );
        break;
      case "ollama": {
        const ollamaUrl = spec?.baseUrl ?? "http://localhost:11434/v1";
        chain.push(
          new OpenAiCompatibleProvider({
            name: "ollama",
            baseUrl: ollamaUrl,
            model: spec?.model ?? "qwen2.5:14b",
            timeoutMs: spec?.timeoutMs ?? 180_000,
            authStyle: "none",
            localStyle: true,
          }),
        );
        break;
      }
      case "lmstudio": {
        let baseUrl = spec?.baseUrl ?? "http://127.0.0.1:1234/v1";
        if (!baseUrl.endsWith("/v1") && !baseUrl.endsWith("/v1/")) {
          baseUrl = baseUrl.replace(/\/+$/, "") + "/v1";
        }
        chain.push(
          new OpenAiCompatibleProvider({
            name: "lmstudio",
            baseUrl,
            apiKey: undefined,
            model: spec?.model ?? "google/gemma-4-e4b",
            timeoutMs: spec?.timeoutMs ?? 180000,
            authStyle: "none",
          }),
        );
        break;
      }
      case "mock":
        chain.push(new MockProvider());
        break;
    }
  }
  if (!chain.length) chain.push(new MockProvider());
  return makeChainedProvider({
    role: opts.role,
    chain,
    tracer,
    tokenBudget: opts.tokenBudget,
  });
}
