import { describe, expect, it } from "vitest";
import { assembleSuites, slugify } from "./suite-assembler";
import type { ExecutableScenario } from "../validation";

function scenario(over: Partial<ExecutableScenario> = {}): ExecutableScenario {
  return {
    id: over.id ?? "S",
    title: over.title ?? "T",
    type: over.type ?? "positive",
    priority: over.priority ?? "P2",
    pageUrl: over.pageUrl ?? "https://x/home",
    steps: [
      {
        index: 0,
        description: "open",
        action: { keyword: "open_page", url: over.pageUrl ?? "https://x/home" },
        resolved: true,
      },
    ],
    expectedResult: {},
    origin: "ai-generated",
    warnings: [],
    designTechnique: "error-guessing",
  };
}

describe("assembleSuites", () => {
  it("groups scenarios by page path", () => {
    const sc = [
      scenario({ id: "a", pageUrl: "https://x/login" }),
      scenario({ id: "b", pageUrl: "https://x/login" }),
      scenario({ id: "c", pageUrl: "https://x/dashboard" }),
    ];
    const suites = assembleSuites(sc);
    expect(suites).toHaveLength(2);
    expect(suites.find((s) => s.featureSlug === "login")?.scenarios).toHaveLength(2);
    expect(suites.find((s) => s.featureSlug === "dashboard")?.scenarios).toHaveLength(1);
  });

  it("treats root URL as 'home' suite", () => {
    const suites = assembleSuites([scenario({ pageUrl: "https://x/" })]);
    expect(suites[0].featureSlug).toBe("home");
  });

  it("returns a single Ad-hoc placeholder for empty input", () => {
    const suites = assembleSuites([]);
    expect(suites).toHaveLength(1);
    expect(suites[0].name).toBe("Ad-hoc");
  });

  it("slugify trims to lowercase kebab", () => {
    expect(slugify("My Feature Page!")).toBe("my-feature-page");
  });
});
