import { describe, expect, it } from "vitest";
import { scoreCandidates } from "./self-heal";
import type { PageElement } from "../validation";

function el(over: Partial<PageElement> = {}): PageElement {
  return {
    id: over.id ?? "e",
    tag: over.tag ?? "button",
    locator: over.locator ?? { kind: "role", role: "button", name: "OK" },
    accessibleName: over.accessibleName,
    isRequired: false,
    isVisible: true,
    isDisabled: false,
    isSensitive: false,
  };
}

describe("scoreCandidates", () => {
  it("only proposes same-kind candidates", () => {
    const els = [
      el({ id: "a", locator: { kind: "role", role: "button", name: "Sign in" } }),
      el({ id: "b", locator: { kind: "label", text: "Sign in" } }),
    ];
    const ranked = scoreCandidates(els, { kind: "role", role: "button", name: "Sign In" });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].locator.kind).toBe("role");
  });

  it("ranks by token-Jaccard similarity (zero-overlap drops out)", () => {
    const els = [
      el({ id: "a", locator: { kind: "role", role: "button", name: "Submit Form" } }),
      el({ id: "b", locator: { kind: "role", role: "button", name: "Submit" } }),
      el({ id: "c", locator: { kind: "role", role: "button", name: "Cancel" } }),
    ];
    const ranked = scoreCandidates(els, { kind: "role", role: "button", name: "Submit" });
    expect(ranked).toHaveLength(2); // Cancel has 0 jaccard so it's filtered
    expect(ranked[0].locator).toMatchObject({ name: "Submit" });
    expect(ranked[1].locator).toMatchObject({ name: "Submit Form" });
  });

  it("returns nothing when no token overlap", () => {
    const els = [
      el({ id: "a", locator: { kind: "role", role: "button", name: "Foo" } }),
    ];
    const ranked = scoreCandidates(els, { kind: "role", role: "button", name: "Bar" });
    expect(ranked).toHaveLength(0);
  });

  it("handles testId locators (exact match → 1)", () => {
    const els = [
      el({ id: "a", locator: { kind: "testId", value: "submit-btn" } }),
      el({ id: "b", locator: { kind: "testId", value: "cancel-btn" } }),
    ];
    const ranked = scoreCandidates(els, { kind: "testId", value: "submit-btn" });
    expect(ranked[0].score).toBe(1);
  });
});
