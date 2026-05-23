import { describe, expect, it } from "vitest";
import { TestPlan } from "./test-plan";

const VALID = {
  id: "R-1",
  generatedAt: "2026-05-17T10:00:00.000Z",
  app: "https://example.com",
  scope: { inScope: ["/login", "/dashboard"], outOfScope: [] },
  testItems: [{ name: "Login", url: "https://example.com/login" }],
  levels: ["system"],
  types: ["functional", "accessibility"],
  approach: "Crawl + AI-driven exploration.",
  entryCriteria: ["Test environment reachable"],
  exitCriteria: ["All P1 scenarios passed"],
  risks: [
    { description: "Flaky locators", likelihood: "med", impact: "med", mitigation: "self-heal" },
  ],
  schedule: { actualStart: "2026-05-17T10:00:00.000Z" },
  resources: { aiProviders: ["claude"], browsers: ["chromium"], locales: ["en"] },
  deliverables: ["reports/html/R-1/index.html"],
  traceabilityMatrix: [],
};

describe("TestPlan schema", () => {
  it("accepts a complete plan", () => {
    expect(TestPlan.parse(VALID).id).toBe("R-1");
  });

  it("rejects empty levels", () => {
    expect(() => TestPlan.parse({ ...VALID, levels: [] })).toThrow();
  });

  it("rejects unknown type", () => {
    expect(() => TestPlan.parse({ ...VALID, types: ["unknown"] })).toThrow();
  });
});
