import type { AiProvider, GenerateInput } from "../provider";
import { ProviderError } from "../provider";
import { getEnv } from "../../config";

/**
 * Minimal Claude provider — calls the Anthropic Messages API and asks the
 * model to return a JSON object that conforms to the provided Zod schema.
 * Designed to be substitutable: any failure throws ProviderError so the
 * resolver can fall back to the next provider in the chain.
 */
export class ClaudeProvider implements AiProvider {
  readonly name = "claude";

  constructor(
    private readonly opts: {
      apiKey?: string;
      model?: string;
      timeoutMs?: number;
      baseUrl?: string;
    } = {},
  ) {}

  async generateStructured<T>(input: GenerateInput<T>): Promise<T> {
    const apiKey = this.opts.apiKey ?? getEnv().CLAUDE_API_KEY;
    if (!apiKey) {
      throw new ProviderError("CLAUDE_API_KEY not set", this.name);
    }
    const model = this.opts.model ?? "claude-opus-4-7";
    const timeoutMs = this.opts.timeoutMs ?? 60_000;
    const baseUrl = this.opts.baseUrl ?? "https://api.anthropic.com";

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const signal = input.signal ?? controller.signal;

    try {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: input.maxTokens ?? 4096,
          system:
            input.systemPrompt +
            "\n\nRespond with a single JSON object. No prose, no markdown.",
          messages: [{ role: "user", content: input.userPrompt }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ProviderError(
          `Claude HTTP ${res.status}: ${body.slice(0, 200)}`,
          this.name,
        );
      }
      const payload = (await res.json()) as {
        content: Array<{ type: string; text?: string }>;
      };
      const text = payload.content
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("");
      const jsonText = extractJson(text);
      const data: unknown = JSON.parse(jsonText);
      const parsed = input.schema.safeParse(data);
      if (!parsed.success) {
        throw new ProviderError(
          `Claude response failed schema: ${parsed.error.message}`,
          this.name,
        );
      }
      return parsed.data as T;
    } finally {
      clearTimeout(t);
    }
  }
}

function extractJson(s: string): string {
  // Tolerate models that wrap JSON in fences.
  const fence = s.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fence) return fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1) return s.slice(first, last + 1);
  return s.trim();
}
