import { z } from "zod";

export interface GenerateInput<T> {
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface TokenUsage {
  input: number;
  output: number;
}

export interface GenerateResult<T> {
  data: T;
  usage?: TokenUsage;
}

export interface AiProvider {
  readonly name: string;
  generateStructured<T>(input: GenerateInput<T>): Promise<T>;
  /**
   * Optional richer variant that also returns token usage when the
   * underlying provider exposes it (Claude / Codex). Local providers
   * may omit it. Defaults to {data} only.
   */
  generateStructuredWithUsage?<T>(
    input: GenerateInput<T>,
  ): Promise<GenerateResult<T>>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class BudgetExceededError extends Error {
  constructor(
    message: string,
    readonly budget: number,
    readonly observed: number,
  ) {
    super(message);
    this.name = "BudgetExceededError";
  }
}
