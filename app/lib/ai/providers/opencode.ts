import { getEnv } from "../../config";
import type { AiProvider, GenerateInput } from "../provider";
import { OpenAiCompatibleProvider } from "./openai-compatible";

/**
 * Opencode adapter — talks to a local OpenAI-compatible server
 * (LM Studio at http://localhost:1234/v1 by default, or Ollama). Useful
 * for low-complexity, offline tasks (per CLAUDE.md routing rules).
 */
export class OpencodeProvider implements AiProvider {
  readonly name = "opencode";
  private readonly inner: OpenAiCompatibleProvider;

  constructor(
    opts: { baseUrl?: string; model?: string; timeoutMs?: number; apiKey?: string } = {},
  ) {
    const baseUrl =
      opts.baseUrl ?? getEnv().OPENCODE_API_URL ?? "http://localhost:1234/v1";
    this.inner = new OpenAiCompatibleProvider({
      name: "opencode",
      baseUrl,
      apiKey: opts.apiKey,
      model: opts.model ?? "google/gemma-4-26b-a4b",
      timeoutMs: opts.timeoutMs ?? 120_000,
      authStyle: opts.apiKey ? "bearer" : "none",
    });
  }

  generateStructured<T>(input: GenerateInput<T>): Promise<T> {
    return this.inner.generateStructured(input);
  }
}
