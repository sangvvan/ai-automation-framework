import { describe, expect, it } from "vitest";
import { designScenarios } from "./test-design";
import { MockProvider } from "../providers/mock";
import type { PageAnalysis } from "../../validation";

const analysis: PageAnalysis = {
  url: "https://example.com/login",
  finalUrl: "https://example.com/login",
  title: "Login",
  viewport: { width: 1280, height: 800 },
  capturedAt: "2026-05-17T10:00:00.000Z",
  screenshotPath: "p.png",
  forms: [{ name: "loginForm", fields: ["username", "password"] }],
  navigation: [],
  consoleErrors: [],
  elements: [
    {
      id: "u",
      tag: "input",
      type: "text",
      locator: { kind: "label", text: "Username" },
      accessibleName: "Username",
      isRequired: true,
      isVisible: true,
      isDisabled: false,
      isSensitive: false,
    },
    {
      id: "p",
      tag: "input",
      type: "password",
      locator: { kind: "label", text: "Password" },
      accessibleName: "Password",
      isRequired: true,
      isVisible: true,
      isDisabled: false,
      isSensitive: true,
    },
    {
      id: "b",
      tag: "button",
      locator: { kind: "role", role: "button", name: "Login" },
      accessibleName: "Login",
      isRequired: false,
      isVisible: true,
      isDisabled: false,
      isSensitive: false,
    },
  ],
};

const fixture = {
  scenarios: [
    {
      id: "GEN_POS_LOGIN",
      title: "Login with valid credentials succeeds",
      type: "positive",
      priority: "P1",
      steps: [
        {
          description: "Open the login page",
          action: { keyword: "open_page", url: "https://example.com/login" },
        },
        {
          description: "Enter username",
          action: {
            keyword: "fill",
            target: { kind: "label", text: "Username" },
            value: "test-user@example.com",
          },
        },
        {
          description: "Enter password",
          action: {
            keyword: "fill",
            target: { kind: "label", text: "Password" },
            value: "Password123!",
          },
        },
        {
          description: "Click Login",
          action: { keyword: "click", target: { kind: "role", role: "button", name: "Login" } },
        },
      ],
      expectedResult: { text: "Welcome" },
    },
    {
      id: "GEN_REQ_USERNAME",
      title: "Submitting empty username shows required",
      type: "required-field",
      priority: "P2",
      steps: [
        { description: "Open page", action: { keyword: "open_page", url: "https://example.com/login" } },
        {
          description: "Click Login",
          action: { keyword: "click", target: { kind: "role", role: "button", name: "Login" } },
        },
      ],
      expectedResult: { text: "Username" },
    },
  ],
};

describe("test-design agent", () => {
  it("produces valid scenarios from a PageAnalysis", async () => {
    const provider = new MockProvider().push(fixture);
    const scenarios = await designScenarios({ analysis, provider });
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios[0].origin).toBe("ai-generated");
    expect(scenarios[0].steps.every((s) => s.resolved)).toBe(true);
  });

  it("respects maxScenarios", async () => {
    const provider = new MockProvider().push(fixture);
    const scenarios = await designScenarios({ analysis, provider, maxScenarios: 1 });
    expect(scenarios).toHaveLength(1);
  });
});
