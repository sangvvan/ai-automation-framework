import { describe, expect, it } from "vitest";
import { Action, ExecutableScenario } from "./scenario";

describe("Action schema", () => {
  it("accepts click with role locator", () => {
    expect(
      Action.parse({
        keyword: "click",
        target: { kind: "role", role: "button", name: "Login" },
      }).keyword,
    ).toBe("click");
  });

  it("rejects unknown keyword", () => {
    expect(() => Action.parse({ keyword: "hover" })).toThrow();
  });
});

describe("ExecutableScenario schema", () => {
  it("accepts a minimal scenario", () => {
    const s = ExecutableScenario.parse({
      id: "TC_LOGIN_001",
      title: "Login with valid credentials",
      type: "positive",
      priority: "P1",
      pageUrl: "https://example.com/login",
      steps: [
        {
          index: 0,
          description: "Open login page",
          action: { keyword: "open_page", url: "https://example.com/login" },
        },
      ],
      expectedResult: { url: "/dashboard" },
      origin: "testcase-yaml",
    });
    expect(s.steps).toHaveLength(1);
  });

  it("rejects scenario with no steps", () => {
    expect(() =>
      ExecutableScenario.parse({
        id: "TC",
        title: "x",
        type: "positive",
        priority: "P1",
        pageUrl: "https://example.com",
        steps: [],
        expectedResult: {},
        origin: "testcase-yaml",
      }),
    ).toThrow();
  });
});
