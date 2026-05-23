import type {
  AiProvider,
  GenerateInput,
  GenerateResult,
  TokenUsage,
} from "../provider";
import { ProviderError } from "../provider";

/**
 * OpenAI-compatible chat-completions client. Used by:
 *   - CodexProvider  (api.openai.com)
 *   - OpencodeProvider (LM Studio / Ollama-compatible local server)
 *
 * The contract: ask the model to return a single JSON object that matches
 * the supplied Zod schema. We extract JSON from the assistant message,
 * parse it, and validate. Any failure throws ProviderError so the chain
 * can fall back.
 */
export interface OpenAiCompatibleOptions {
  name: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  /** Some local servers (LM Studio) need the auth header skipped. */
  authStyle?: "bearer" | "none";
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly name: string;
  private readonly opts: OpenAiCompatibleOptions;

  constructor(opts: OpenAiCompatibleOptions) {
    this.opts = opts;
    this.name = opts.name;
  }

  async generateStructured<T>(input: GenerateInput<T>): Promise<T> {
    const r = await this.generateStructuredWithUsage(input);
    return r.data;
  }

  async generateStructuredWithUsage<T>(
    input: GenerateInput<T>,
  ): Promise<GenerateResult<T>> {
    const timeoutMs = this.opts.timeoutMs ?? 60_000;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const signal = input.signal ?? controller.signal;

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.authStyle !== "none") {
      if (!this.opts.apiKey) {
        clearTimeout(t);
        throw new ProviderError(`${this.name}: API key not set`, this.name);
      }
      headers["authorization"] = `Bearer ${this.opts.apiKey}`;
    }

    const isReasoningModel =
      this.opts.model.startsWith("o") ||
      this.opts.model.startsWith("gpt-5") ||
      this.opts.model.startsWith("gpt-6");

    const body: Record<string, any> = {
      model: this.opts.model,
      response_format: { type: "json_object" } as const,
      messages: [
        {
          role: "system" as const,
          content:
            input.systemPrompt +
            "\n\nRespond with a single JSON object. No prose, no markdown.",
        },
        { role: "user" as const, content: input.userPrompt },
      ],
    };

    if (isReasoningModel) {
      body.max_completion_tokens = input.maxTokens ?? 4096;
    } else {
      body.max_tokens = input.maxTokens ?? 4096;
      body.temperature = 0.2;
    }

    try {
      const res = await fetch(`${this.opts.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        signal,
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new ProviderError(
          `${this.name} HTTP ${res.status}: ${txt.slice(0, 200)}`,
          this.name,
        );
      }
      const payload = (await res.json()) as {
        choices: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = payload.choices?.[0]?.message?.content ?? "";
      if (!text) {
        throw new ProviderError(`${this.name}: empty response`, this.name);
      }
      const jsonText = extractJson(text);
      let data: unknown;
      try {
        data = JSON.parse(jsonText);
      } catch (err) {
        throw new ProviderError(
          `${this.name}: response was not JSON: ${(err as Error).message}`,
          this.name,
        );
      }
      const parsed = input.schema.safeParse(data);
      if (!parsed.success) {
        throw new ProviderError(
          `${this.name}: response failed schema: ${parsed.error.message}`,
          this.name,
        );
      }
      const usage: TokenUsage | undefined = payload.usage
        ? {
            input: payload.usage.prompt_tokens ?? 0,
            output: payload.usage.completion_tokens ?? 0,
          }
        : undefined;
      return { data: parsed.data as T, usage };
    } finally {
      clearTimeout(t);
    }
  }
}

export function extractJson(s: string): string {
  const fence = s.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fence) return fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) return s.slice(first, last + 1);
  return s.trim();
}
