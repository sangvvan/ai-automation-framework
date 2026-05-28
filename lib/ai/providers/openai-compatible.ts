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
  /**
   * Force Ollama/local-style behaviour regardless of the URL:
   * skip response_format, use streaming to avoid server-side timeouts,
   * and use 8192 max_tokens for thinking models (e.g. remote vLLM/Gemma 4).
   */
  localStyle?: boolean;
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

    const isLocalUrl =
      this.opts.baseUrl.includes("localhost") ||
      this.opts.baseUrl.includes("127.0.0.1");
    // Skip response_format for Ollama-compatible servers (local or remote vLLM).
    const skipResponseFormat = this.opts.localStyle === true || isLocalUrl;
    // Token cap: 2048 only for truly local URLs (OOM risk); remote servers get 8192.
    // Thinking models (e.g. Gemma 4) need the larger budget to complete CoT + response.
    const defaultMaxTokens = isLocalUrl ? 2048 : 8192;

    const baseUrl = this.opts.baseUrl.replace(/\/+$/, "");

    const body: Record<string, unknown> = {
      model: this.opts.model,
      // response_format json_object is not supported by Ollama/vLLM servers;
      // we rely on the system prompt + extractJson() instead.
      ...(skipResponseFormat ? {} : { response_format: { type: "json_object" } }),
      messages: [
        {
          role: "system" as const,
          content:
            input.systemPrompt +
            "\n\nYou MUST respond with a single JSON object only. " +
            "No explanation, no markdown fences — just raw JSON.",
        },
        { role: "user" as const, content: input.userPrompt },
      ],
    };

    if (isReasoningModel) {
      body.max_completion_tokens = input.maxTokens ?? defaultMaxTokens;
    } else {
      body.max_tokens = input.maxTokens ?? defaultMaxTokens;
      body.temperature = skipResponseFormat ? 0.1 : 0.2;
    }

    try {
      // Use SSE streaming for Ollama/vLLM to avoid server-side hard timeouts.
      // The server closes idle connections at ~300s, but streaming keeps the
      // connection alive as tokens flow in.
      if (this.opts.localStyle) {
        return await this._fetchStreaming<T>(baseUrl, headers, body, signal, input);
      }
      return await this._fetchJson<T>(baseUrl, headers, body, signal, input);
    } finally {
      clearTimeout(t);
    }
  }

  private async _fetchJson<T>(
    baseUrl: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    signal: AbortSignal,
    input: GenerateInput<T>,
  ): Promise<GenerateResult<T>> {
    const res = await fetch(`${baseUrl}/chat/completions`, {
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
      choices: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = payload.choices?.[0]?.message?.content ?? "";
    if (!text) {
      throw new ProviderError(`${this.name}: empty response`, this.name);
    }
    return this._parseAndValidate(text, payload.usage, input);
  }

  private async _fetchStreaming<T>(
    baseUrl: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    signal: AbortSignal,
    input: GenerateInput<T>,
  ): Promise<GenerateResult<T>> {
    const streamBody = {
      ...body,
      stream: true,
      stream_options: { include_usage: true },
    };
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers,
      body: JSON.stringify(streamBody),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new ProviderError(
        `${this.name} HTTP ${res.status}: ${txt.slice(0, 200)}`,
        this.name,
      );
    }
    if (!res.body) {
      throw new ProviderError(`${this.name}: no response body`, this.name);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let content = "";
    let rawUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const chunk = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string | null } }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) content += delta;
            if (chunk.usage) rawUsage = chunk.usage;
          } catch {
            // malformed SSE chunk — skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!content) {
      throw new ProviderError(`${this.name}: empty response`, this.name);
    }
    return this._parseAndValidate(content, rawUsage, input);
  }

  private _parseAndValidate<T>(
    text: string,
    rawUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
    input: GenerateInput<T>,
  ): GenerateResult<T> {
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
    const usage: TokenUsage | undefined = rawUsage
      ? {
          input: rawUsage.prompt_tokens ?? 0,
          output: rawUsage.completion_tokens ?? 0,
        }
      : undefined;
    return { data: parsed.data as T, usage };
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
