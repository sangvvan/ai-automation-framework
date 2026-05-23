import { describe, expect, it } from "vitest";
import { Locator, locatorKey } from "./locator";

describe("Locator schema", () => {
  it("accepts a role locator with name", () => {
    const parsed = Locator.parse({ kind: "role", role: "button", name: "Login" });
    expect(parsed.kind).toBe("role");
    expect(locatorKey(parsed)).toBe("role:button:Login");
  });

  it("accepts a testId locator", () => {
    expect(Locator.parse({ kind: "testId", value: "submit" }).kind).toBe("testId");
  });

  it("rejects unknown kind", () => {
    expect(() => Locator.parse({ kind: "xpath", value: "//a" })).toThrow();
  });

  it("rejects empty text locator", () => {
    expect(() => Locator.parse({ kind: "text", text: "" })).toThrow();
  });
});
