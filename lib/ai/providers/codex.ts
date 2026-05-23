import { getEnv } from "../../config";
import type { AiProvider, GenerateInput, GenerateResult } from "../provider";
import { OpenAiCompatibleProvider } from "./openai-compatible";

/**
 * Codex == OpenAI chat-completions under the hood. The framework's
 * fallback chain treats Codex as the cloud non-Claude option per CLAUDE.md.
 */
export class CodexProvider implements AiProvider {
  readonly name = "codex";
  private readonly inner: OpenAiCompatibleProvider;

  constructor(
    opts: { apiKey?: string; model?: string; timeoutMs?: number; baseUrl?: string } = {},
  ) {
    const apiKey = opts.apiKey ?? getEnv().CODEX_API_KEY;
    this.inner = new OpenAiCompatibleProvider({
      name: "codex",
      baseUrl: opts.baseUrl ?? "https://api.openai.com/v1",
      apiKey,
      model: opts.model ?? "gpt-4.1-mini",
      timeoutMs: opts.timeoutMs ?? 60_000,
      authStyle: apiKey ? "bearer" : "none",
    });
  }

  generateStructured<T>(input: GenerateInput<T>): Promise<T> {
    return this.inner.generateStructured(input);
  }

  generateStructuredWithUsage<T>(
    input: GenerateInput<T>,
  ): Promise<GenerateResult<T>> {
    return this.inner.generateStructuredWithUsage(input);
  }
}
