import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAiCompatibleProvider, extractJson } from "./openai-compatible";
import { ProviderError } from "../provider";

const schema = z.object({ value: z.number() });

function mockFetch(response: {
  ok: boolean;
  status?: number;
  body: unknown;
  text?: string;
}) {
  return vi.fn(async () => {
    if (!response.ok) {
      return {
        ok: false,
        status: response.status ?? 500,
        text: async () => response.text ?? "",
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => response.body,
    } as unknown as Response;
  });
}

describe("OpenAiCompatibleProvider", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    // ensure a clean slate per test
    globalThis.fetch = realFetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("returns parsed structured output on 200", async () => {
    globalThis.fetch = mockFetch({
      ok: true,
      body: {
        choices: [{ message: { content: '{"value":42}' } }],
      },
    }) as unknown as typeof fetch;
    const p = new OpenAiCompatibleProvider({
      name: "x",
      baseUrl: "https://x/v1",
      apiKey: "k",
      model: "m",
    });
    const out = await p.generateStructured({
      systemPrompt: "s",
      userPrompt: "u",
      schema,
    });
    expect(out.value).toBe(42);
  });

  it("throws ProviderError on non-2xx", async () => {
    globalThis.fetch = mockFetch({
      ok: false,
      status: 502,
      body: null,
      text: "bad gateway",
    }) as unknown as typeof fetch;
    const p = new OpenAiCompatibleProvider({
      name: "x",
      baseUrl: "https://x/v1",
      apiKey: "k",
      model: "m",
    });
    await expect(
      p.generateStructured({ systemPrompt: "s", userPrompt: "u", schema }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("throws ProviderError when JSON fails the schema", async () => {
    globalThis.fetch = mockFetch({
      ok: true,
      body: { choices: [{ message: { content: '{"value":"not-a-number"}' } }] },
    }) as unknown as typeof fetch;
    const p = new OpenAiCompatibleProvider({
      name: "x",
      baseUrl: "https://x/v1",
      apiKey: "k",
      model: "m",
    });
    await expect(
      p.generateStructured({ systemPrompt: "s", userPrompt: "u", schema }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("refuses to call when bearer required but apiKey missing", async () => {
    const p = new OpenAiCompatibleProvider({
      name: "x",
      baseUrl: "https://x/v1",
      model: "m",
      authStyle: "bearer",
    });
    await expect(
      p.generateStructured({ systemPrompt: "s", userPrompt: "u", schema }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("extractJson", () => {
  it("returns the body of a fenced block", () => {
    expect(extractJson('foo ```json\n{"x":1}\n``` bar')).toBe('{"x":1}');
  });
  it("returns the JSON object span when unfenced", () => {
    expect(extractJson('intro {"x":1} trailing')).toBe('{"x":1}');
  });
  it("returns the trimmed input when neither pattern matches", () => {
    expect(extractJson("  raw text  ")).toBe("raw text");
  });
});
