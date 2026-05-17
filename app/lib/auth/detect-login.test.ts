import { describe, expect, it } from "vitest";
import { AmbiguousLoginFormError, detectLoginForm } from "./detect-login";
import type { PageAnalysis, PageElement } from "../validation";

function element(over: Partial<PageElement> = {}): PageElement {
  return {
    id: over.id ?? "e",
    tag: over.tag ?? "input",
    type: over.type,
    locator: over.locator ?? { kind: "label", text: over.id ?? "x" },
    accessibleName: over.accessibleName,
    isRequired: over.isRequired ?? false,
    isVisible: over.isVisible ?? true,
    isDisabled: over.isDisabled ?? false,
    isSensitive: over.isSensitive ?? false,
    attributes: over.attributes,
  };
}

function analysis(els: PageElement[]): PageAnalysis {
  return {
    url: "https://example.com/login",
    finalUrl: "https://example.com/login",
    title: "Login",
    viewport: { width: 1280, height: 800 },
    capturedAt: "2026-05-17T10:00:00.000Z",
    screenshotPath: "p.png",
    elements: els,
    forms: [],
    navigation: [],
    consoleErrors: [],
  };
}

describe("detectLoginForm", () => {
  it("detects a classic email/password form", () => {
    const a = analysis([
      element({
        id: "e",
        tag: "input",
        type: "email",
        accessibleName: "Email",
        locator: { kind: "label", text: "Email" },
      }),
      element({
        id: "p",
        tag: "input",
        type: "password",
        accessibleName: "Password",
        locator: { kind: "label", text: "Password" },
        isSensitive: true,
      }),
      element({
        id: "b",
        tag: "button",
        accessibleName: "Sign in",
        locator: { kind: "role", role: "button", name: "Sign in" },
      }),
    ]);
    const r = detectLoginForm(a);
    expect(r.fields.username.value).toBe("${SITE_USERNAME}");
    expect(r.fields.password.value).toBe("${SITE_PASSWORD}");
    expect(r.submit.locator).toEqual({ kind: "role", role: "button", name: "Sign in" });
  });

  it("aborts when no password input", () => {
    const a = analysis([
      element({ id: "e", tag: "input", type: "text" }),
      element({ id: "b", tag: "button", accessibleName: "Go" }),
    ]);
    expect(() => detectLoginForm(a)).toThrow(AmbiguousLoginFormError);
  });

  it("aborts when multiple text inputs and none hinted", () => {
    const a = analysis([
      element({ id: "a", tag: "input", type: "text" }),
      element({ id: "b", tag: "input", type: "text" }),
      element({ id: "p", tag: "input", type: "password", isSensitive: true }),
      element({ id: "btn", tag: "button" }),
    ]);
    expect(() => detectLoginForm(a)).toThrow(AmbiguousLoginFormError);
  });

  it("uses the hinted text input when multiple exist", () => {
    const a = analysis([
      element({ id: "n", tag: "input", type: "text", accessibleName: "Full name" }),
      element({
        id: "e",
        tag: "input",
        type: "text",
        accessibleName: "Username",
        locator: { kind: "label", text: "Username" },
      }),
      element({ id: "p", tag: "input", type: "password", isSensitive: true }),
      element({
        id: "btn",
        tag: "button",
        accessibleName: "Sign in",
        locator: { kind: "role", role: "button", name: "Sign in" },
      }),
    ]);
    const r = detectLoginForm(a);
    expect(r.fields.username.locator).toEqual({ kind: "label", text: "Username" });
  });
});
