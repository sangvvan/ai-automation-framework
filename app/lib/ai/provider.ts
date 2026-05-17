import { z } from "zod";

export interface GenerateInput<T> {
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AiProvider {
  readonly name: string;
  generateStructured<T>(input: GenerateInput<T>): Promise<T>;
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
