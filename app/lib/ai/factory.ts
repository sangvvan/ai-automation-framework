import type { FrameworkConfig } from "../config";
import { ClaudeProvider } from "./providers/claude";
import { MockProvider } from "./providers/mock";
import type { AiProvider } from "./provider";
import { makeChainedProvider } from "./resolve";
import { fileTracer, noopTracer, type Tracer } from "./trace";

export interface BuildProviderOptions {
  config: FrameworkConfig;
  role: string;
  tracePath?: string;
}

export function buildProvider(opts: BuildProviderOptions): AiProvider {
  const cfg = opts.config.ai;
  const chainNames = cfg.fallbackChain?.[opts.role] ?? [cfg.defaultProvider];
  const tracer: Tracer = opts.tracePath ? fileTracer(opts.tracePath) : noopTracer;
  const chain: AiProvider[] = [];
  for (const name of chainNames) {
    const spec = cfg.providers?.[name];
    if (!spec?.enabled && name !== "mock") continue;
    switch (name) {
      case "claude":
        chain.push(
          new ClaudeProvider({ model: spec?.model, timeoutMs: spec?.timeoutMs }),
        );
        break;
      case "mock":
        chain.push(new MockProvider());
        break;
      default:
        // Other providers (codex/opencode) are stubs in MVP; skip silently.
        break;
    }
  }
  if (!chain.length) chain.push(new MockProvider());
  return makeChainedProvider({ role: opts.role, chain, tracer });
}
