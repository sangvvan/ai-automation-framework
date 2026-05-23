import { describe, expect, it } from "vitest";
import { generateValue } from "./test-data-gen";

describe("generateValue", () => {
  it("is deterministic for the same seed + field", () => {
    const a = generateValue({ fieldName: "email", seed: "R-1::S::0" });
    const b = generateValue({ fieldName: "email", seed: "R-1::S::0" });
    expect(a).toBe(b);
  });

  it("returns email-shaped string for email inputs", () => {
    const v = generateValue({ fieldName: "Email", fieldType: "email", seed: "x" });
    expect(v).toMatch(/.+@.+\..+/);
  });

  it("respects locale", () => {
    const en = generateValue({ fieldName: "email", seed: "x", locale: "en" });
    const vi = generateValue({ fieldName: "email", seed: "x", locale: "vi" });
    expect(en).toMatch(/@example\.com$/);
    expect(vi).toMatch(/@example\.vn$/);
  });

  it("masks password fields with a safe placeholder", () => {
    const v = generateValue({ fieldName: "Password", fieldType: "password", seed: "x" });
    expect(v).toBe("Test-Pass-1234!");
  });

  it("re-rolls when the first candidate is forbidden", () => {
    const forbidden = new Set([
      generateValue({ fieldName: "Username", seed: "x" }),
    ]);
    const v = generateValue({ fieldName: "Username", seed: "x", forbidden });
    expect(forbidden.has(v)).toBe(false);
  });
});
