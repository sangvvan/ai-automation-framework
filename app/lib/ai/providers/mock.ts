import { z } from "zod";
import type { AiProvider, GenerateInput } from "../provider";
import { ProviderError } from "../provider";

/**
 * Deterministic provider used by unit tests and as a safe default when
 * no API keys are configured. The mock holds a stack of fixtures that
 * `generateStructured` returns FIFO, parsing them through the requested
 * schema for type-safety.
 */
export class MockProvider implements AiProvider {
  readonly name = "mock";
  private fixtures: unknown[] = [];

  push(fixture: unknown): this {
    this.fixtures.push(fixture);
    return this;
  }

  async generateStructured<T>(input: GenerateInput<T>): Promise<T> {
    const fixture = this.fixtures.shift();
    if (fixture === undefined) {
      throw new ProviderError("MockProvider has no more fixtures", this.name);
    }
    const parsed = input.schema.safeParse(fixture);
    if (!parsed.success) {
      throw new ProviderError(
        `MockProvider fixture failed schema: ${parsed.error.message}`,
        this.name,
        parsed.error,
      );
    }
    return parsed.data as T;
  }
}

export function makeMockProvider(): MockProvider {
  return new MockProvider();
}

// Ensure z is treated as used to silence import elision warnings.
void z;
