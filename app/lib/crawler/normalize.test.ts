import { describe, expect, it } from "vitest";
import {
  normalizeUrl,
  registrableDomainOf,
  sameOrigin,
  sameRegistrableDomain,
} from "./normalize";

describe("normalizeUrl", () => {
  it("strips default ports and fragments", () => {
    expect(normalizeUrl("HTTPS://Example.COM:443/a#x")).toBe("https://example.com/a");
  });

  it("drops tracking params and sorts the rest", () => {
    expect(normalizeUrl("https://x/p?utm_source=a&z=1&a=2&fbclid=y")).toBe(
      "https://x/p?a=2&z=1",
    );
  });

  it("strips trailing slash on deep paths only", () => {
    expect(normalizeUrl("https://x/foo/")).toBe("https://x/foo");
    expect(normalizeUrl("https://x/")).toBe("https://x/");
  });

  it("honours extra ignoreParams", () => {
    expect(normalizeUrl("https://x?sid=1&keep=ok", { ignoreParams: ["sid"] })).toBe(
      "https://x/?keep=ok",
    );
  });
});

describe("sameOrigin / sameRegistrableDomain", () => {
  it("origin comparison ignores path", () => {
    expect(sameOrigin("https://x/a", "https://x/b")).toBe(true);
    expect(sameOrigin("https://x", "http://x")).toBe(false);
  });

  it("registrable domain collapses subdomains", () => {
    expect(sameRegistrableDomain("https://a.example.com", "https://b.example.com")).toBe(true);
    expect(sameRegistrableDomain("https://example.com", "https://other.com")).toBe(false);
    expect(registrableDomainOf("https://a.b.example.com")).toBe("example.com");
  });
});
