import type { AiProvider, GenerateInput } from "../provider";
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

    const body = {
      model: this.opts.model,
      max_tokens: input.maxTokens ?? 4096,
      // Encourage strict JSON. Servers that don't recognise response_format
      // just ignore it — we still post-process the message text.
      response_format: { type: "json_object" } as const,
      temperature: 0.2,
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
      return parsed.data as T;
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
