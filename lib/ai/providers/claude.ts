import type { AiProvider, GenerateInput, GenerateResult, TokenUsage } from "../provider";
import { ProviderError } from "../provider";
import { getEnv } from "../../config";

/**
 * Anthropic Claude provider.
 *
 * Calls the Anthropic Messages API and asks the model to return a JSON
 * object that conforms to the provided Zod schema.
 *
 * Default model: claude-sonnet-4-6  (fast, smart, cost-efficient)
 * For highest quality: set model: claude-opus-4-6 in ai-provider.yaml
 *
 * Implements generateStructuredWithUsage so the chained provider can
 * accumulate token counts for budget enforcement (REQ-017).
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
    const { data } = await this.generateStructuredWithUsage(input);
    return data;
  }

  async generateStructuredWithUsage<T>(
    input: GenerateInput<T>,
  ): Promise<GenerateResult<T>> {
    const apiKey = this.opts.apiKey ?? getEnv().CLAUDE_API_KEY;
    if (!apiKey) {
      throw new ProviderError(
        "CLAUDE_API_KEY is not set. Add it to .env or export it as an environment variable.",
        this.name,
      );
    }

    const model     = this.opts.model ?? "claude-sonnet-4-6";
    const timeoutMs = this.opts.timeoutMs ?? 90_000;
    const baseUrl   = (this.opts.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
          max_tokens: input.maxTokens ?? 8192,
          system:
            input.systemPrompt +
            "\n\nYou MUST respond with a single valid JSON object only. " +
            "No explanation, no markdown fences, no prose — just the JSON.",
          messages: [{ role: "user", content: input.userPrompt }],
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ProviderError(
          `Claude HTTP ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
          this.name,
        );
      }

      const payload = (await res.json()) as {
        content: Array<{ type: string; text?: string }>;
        usage?: { input_tokens: number; output_tokens: number };
        stop_reason?: string;
      };

      if (payload.stop_reason === "max_tokens") {
        throw new ProviderError(
          `Claude hit max_tokens limit (${input.maxTokens ?? 8192}). ` +
          "Reduce maxScenariosPerPage or increase max_tokens.",
          this.name,
        );
      }

      const text = payload.content
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("");

      const jsonText = extractJson(text);
      let raw: unknown;
      try {
        raw = JSON.parse(jsonText);
      } catch {
        throw new ProviderError(
          `Claude returned non-JSON: ${jsonText.slice(0, 200)}`,
          this.name,
        );
      }

      const parsed = input.schema.safeParse(raw);
      if (!parsed.success) {
        throw new ProviderError(
          `Claude response failed schema validation: ${parsed.error.message.slice(0, 400)}`,
          this.name,
        );
      }

      const usage: TokenUsage = {
        input:  payload.usage?.input_tokens  ?? 0,
        output: payload.usage?.output_tokens ?? 0,
      };

      return { data: parsed.data as T, usage };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip markdown code fences and extract the outermost JSON object/array. */
function extractJson(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) return fenced[1].trim();

  const firstBrace   = s.indexOf("{");
  const firstBracket = s.indexOf("[");
  const start =
    firstBrace === -1 ? firstBracket :
    firstBracket === -1 ? firstBrace :
    Math.min(firstBrace, firstBracket);

  if (start === -1) return s.trim();
  const close = s[start] === "{" ? "}" : "]";
  const last = s.lastIndexOf(close);
  return last > start ? s.slice(start, last + 1) : s.trim();
}
