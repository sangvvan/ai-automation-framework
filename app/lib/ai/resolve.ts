import { randomUUID } from "node:crypto";
import type { AiProvider, GenerateInput } from "./provider";
import type { Tracer } from "./trace";
import { noopTracer } from "./trace";
import { ProviderError } from "./provider";

export interface ChainedProvider extends AiProvider {
  readonly chain: string[];
}

export interface ResolveOptions {
  role: string;
  chain: AiProvider[];
  tracer?: Tracer;
}

/**
 * Try providers in order; on any failure (ProviderError, network), fall
 * back to the next one. The trace logs each attempt for audit.
 */
export function makeChainedProvider(opts: ResolveOptions): ChainedProvider {
  const tracer = opts.tracer ?? noopTracer;
  const chain = opts.chain.map((p) => p.name);
  return {
    name: `chain(${chain.join(",")})`,
    chain,
    async generateStructured<T>(input: GenerateInput<T>): Promise<T> {
      let lastErr: unknown;
      let attempt = 0;
      for (const provider of opts.chain) {
        attempt++;
        const requestId = randomUUID();
        const started = Date.now();
        try {
          const result = await provider.generateStructured(input);
          await tracer.log({
            at: new Date().toISOString(),
            provider: provider.name,
            role: opts.role,
            requestId,
            durationMs: Date.now() - started,
            status: "ok",
            attempt,
          });
          return result;
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
          // continue to next provider
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
