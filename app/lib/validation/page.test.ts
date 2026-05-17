import { describe, expect, it } from "vitest";
import { PageAnalysis, PageElement } from "./page";

const baseElement: PageElement = {
  id: "e1",
  tag: "button",
  locator: { kind: "role", role: "button", name: "Login" },
  accessibleName: "Login",
  isRequired: false,
  isVisible: true,
  isDisabled: false,
  isSensitive: false,
};

describe("PageElement schema", () => {
  it("accepts a minimal element", () => {
    expect(PageElement.parse(baseElement).id).toBe("e1");
  });

  it("rejects element without tag", () => {
    expect(() =>
      PageElement.parse({ ...baseElement, tag: "" }),
    ).toThrow();
  });
});

describe("PageAnalysis schema", () => {
  it("accepts a valid analysis", () => {
    const a = PageAnalysis.parse({
      url: "https://example.com",
      finalUrl: "https://example.com/",
      title: "Example",
      viewport: { width: 1280, height: 800 },
      capturedAt: "2026-05-17T10:00:00.000Z",
      screenshotPath: "reports/evidence/r1/page.png",
      elements: [baseElement],
      forms: [{ fields: ["email", "password"] }],
      navigation: [{ name: "Home", href: "/" }],
      consoleErrors: [],
    });
    expect(a.elements).toHaveLength(1);
  });

  it("rejects invalid URL", () => {
    expect(() =>
      PageAnalysis.parse({
        url: "not-a-url",
        finalUrl: "https://example.com/",
        title: "x",
        viewport: { width: 1, height: 1 },
        capturedAt: "2026-05-17T10:00:00.000Z",
        screenshotPath: "p",
        elements: [],
      }),
    ).toThrow();
  });
});
