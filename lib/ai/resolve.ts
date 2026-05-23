import { randomUUID } from "node:crypto";
import type { AiProvider, GenerateInput, TokenUsage } from "./provider";
import type { Tracer } from "./trace";
import { noopTracer } from "./trace";
import { BudgetExceededError, ProviderError } from "./provider";

export interface ChainedProvider extends AiProvider {
  readonly chain: string[];
  /** Total tokens consumed across all calls. */
  totalUsage(): TokenUsage;
}

export interface ResolveOptions {
  role: string;
  chain: AiProvider[];
  tracer?: Tracer;
  /** Hard cap on (input+output) tokens across all calls on this chain. */
  tokenBudget?: number;
}

/**
 * Try providers in order; on any failure (ProviderError, network), fall
 * back to the next one. The trace logs each attempt for audit. Token
 * usage (where reported) is accumulated; the next call is rejected
 * with BudgetExceededError once `tokenBudget` is exceeded.
 */
export function makeChainedProvider(opts: ResolveOptions): ChainedProvider {
  const tracer = opts.tracer ?? noopTracer;
  const chain = opts.chain.map((p) => p.name);
  const cumul: TokenUsage = { input: 0, output: 0 };

  return {
    name: `chain(${chain.join(",")})`,
    chain,
    totalUsage: () => ({ ...cumul }),

    async generateStructured<T>(input: GenerateInput<T>): Promise<T> {
      if (opts.tokenBudget !== undefined) {
        const total = cumul.input + cumul.output;
        if (total >= opts.tokenBudget) {
          throw new BudgetExceededError(
            `Token budget exhausted: ${total} >= ${opts.tokenBudget}`,
            opts.tokenBudget,
            total,
          );
        }
      }

      let lastErr: unknown;
      let attempt = 0;
      for (const provider of opts.chain) {
        attempt++;
        const requestId = randomUUID();
        const started = Date.now();
        try {
          let data: T;
          let usage: TokenUsage | undefined;
          if (provider.generateStructuredWithUsage) {
            const r = await provider.generateStructuredWithUsage(input);
            data = r.data;
            usage = r.usage;
          } else {
            data = await provider.generateStructured(input);
          }
          if (usage) {
            cumul.input += usage.input;
            cumul.output += usage.output;
          }
          await tracer.log({
            at: new Date().toISOString(),
            provider: provider.name,
            role: opts.role,
            requestId,
            durationMs: Date.now() - started,
            status: "ok",
            attempt,
            tokensIn: usage?.input,
            tokensOut: usage?.output,
            cumulativeTokens: cumul.input + cumul.output,
          });
          return data;
        } catch (err) {
          lastErr = err;
          await tracer.log({
            at: new Date().toISOString(),
            provider: provider.name,
            role: opts.role,
            requestId,
            durationMs: Date.now() - started,
            status: attempt < opts.chain.length ? "fallback" : "error",
            attempt,
            error: (err as Error).message,
          });
        }
      }
      throw new ProviderError(
        `All providers in chain failed for role=${opts.role}: ${(lastErr as Error)?.message}`,
        "chain",
        lastErr,
      );
    },
  };
}
