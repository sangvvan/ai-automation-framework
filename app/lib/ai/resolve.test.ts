import { describe, expect, it } from "vitest";
import { z } from "zod";
import { makeChainedProvider } from "./resolve";
import { MockProvider } from "./providers/mock";
import { ProviderError } from "./provider";

describe("chained provider", () => {
  const schema = z.object({ value: z.number() });

  it("returns the first provider's result on success", async () => {
    const a = new MockProvider().push({ value: 1 });
    const b = new MockProvider().push({ value: 2 });
    const chained = makeChainedProvider({ role: "design", chain: [a, b] });
    const r = await chained.generateStructured({
      systemPrompt: "s",
      userPrompt: "u",
      schema,
    });
    expect(r.value).toBe(1);
  });

  it("falls back to next provider on error", async () => {
    const a = new MockProvider(); // no fixtures -> throws
    const b = new MockProvider().push({ value: 42 });
    const chained = makeChainedProvider({ role: "design", chain: [a, b] });
    const r = await chained.generateStructured({
      systemPrompt: "s",
      userPrompt: "u",
      schema,
    });
    expect(r.value).toBe(42);
  });

  it("throws when all providers fail", async () => {
    const a = new MockProvider();
    const b = new MockProvider();
    const chained = makeChainedProvider({ role: "design", chain: [a, b] });
    await expect(
      chained.generateStructured({ systemPrompt: "s", userPrompt: "u", schema }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
