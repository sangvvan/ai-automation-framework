import { describe, expect, it } from "vitest";
import {
  TestCaseValidationError,
  parseYamlTestCase,
  parseMarkdownTestCase,
} from "./parse";
import { mapStepsToActions } from "./step-mapper";
import type { PageAnalysis } from "../validation";

const sampleYaml = `
page_url: "https://example.com/login"
test_cases:
  - id: TC_LOGIN_001
    title: "Login with valid user"
    priority: P1
    type: positive
    steps:
      - Open login page
      - Enter valid username
      - Click Login
    expected_result: "Welcome"
`;

describe("YAML parser", () => {
  it("parses a valid YAML test-case file", () => {
    const scenarios = parseYamlTestCase(sampleYaml);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].id).toBe("TC_LOGIN_001");
    expect(scenarios[0].steps).toHaveLength(3);
    expect(scenarios[0].origin).toBe("testcase-yaml");
  });

  it("rejects a YAML file missing steps", () => {
    const bad = `
page_url: "https://example.com/login"
test_cases:
  - id: TC
    title: missing
`;
    try {
      parseYamlTestCase(bad);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TestCaseValidationError);
      expect((err as TestCaseValidationError).issues[0].path.join(".")).toMatch(/steps/);
    }
  });
});

describe("Markdown parser", () => {
  it("parses a markdown test-case", () => {
    const md = `
# TC_HOME_001: Open homepage
- page: https://example.com
- priority: P2
## Steps
1. Open the homepage
2. Verify Welcome
## Expected result
Welcome to example
`;
    const scenarios = parseMarkdownTestCase(md);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].steps).toHaveLength(2);
    expect(scenarios[0].origin).toBe("testcase-md");
  });
});

const analysis: PageAnalysis = {
  url: "https://example.com/login",
  finalUrl: "https://example.com/login",
  title: "Login",
  viewport: { width: 1280, height: 800 },
  capturedAt: "2026-05-17T10:00:00.000Z",
  screenshotPath: "p.png",
  elements: [
    {
      id: "e1",
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
      id: "e2",
      tag: "button",
      locator: { kind: "role", role: "button", name: "Login" },
      accessibleName: "Login",
      isRequired: false,
      isVisible: true,
      isDisabled: false,
      isSensitive: false,
    },
  ],
  forms: [],
  navigation: [],
  consoleErrors: [],
};

describe("step mapper", () => {
  it("maps 'Click Login' to click on role:button:Login", () => {
    const r = mapStepsToActions(
      [
        {
          index: 0,
          description: "Click Login",
          action: { keyword: "open_page", url: "https://example.com" },
          resolved: false,
        },
      ],
      analysis,
      "https://example.com/login",
    );
    expect(r.steps[0].action.keyword).toBe("click");
    const target = (r.steps[0].action as { target: { kind: string; name?: string } }).target;
    expect(target.kind).toBe("role");
    expect(target.name).toBe("Login");
    expect(r.warnings).toHaveLength(0);
  });

  it("warns on unmappable step", () => {
    const r = mapStepsToActions(
      [
        {
          index: 0,
          description: "Click Foo",
          action: { keyword: "open_page", url: "https://example.com" },
          resolved: false,
        },
      ],
      analysis,
      "https://example.com/login",
    );
    expect(r.steps[0].resolved).toBe(false);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].reason).toMatch(/no matching/);
  });
});
