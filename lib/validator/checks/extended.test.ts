import { describe, expect, it } from "vitest";
import { runExtendedChecksPure } from "./extended";

describe("runExtendedChecksPure (pure subset)", () => {
  it("passes url-not-contains when URL is clean", () => {
    const checks = runExtendedChecksPure({
      finalUrl: "https://x/home",
      expected: { urlNotContains: "/login" },
    });
    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe("passed");
  });

  it("fails url-not-contains when URL still matches", () => {
    const checks = runExtendedChecksPure({
      finalUrl: "https://x/login?next=/home",
      expected: { urlNotContains: "/login" },
    });
    expect(checks[0].status).toBe("failed");
    expect(checks[0].detail).toMatch(/login/);
  });

  it("passes text-not-contains when text absent", () => {
    const checks = runExtendedChecksPure({
      finalText: "Welcome, Sang",
      expected: { textNotContains: "Error" },
    });
    expect(checks[0].status).toBe("passed");
  });

  it("fails text-not-contains when text appears", () => {
    const checks = runExtendedChecksPure({
      finalText: "Error: invalid",
      expected: { textNotContains: "Error" },
    });
    expect(checks[0].status).toBe("failed");
  });
});
