import { describe, expect, it } from "vitest";
import { parseYamlTestCase } from "../scenario/parse";
import type { ExecutableScenario } from "../validation";
import { scenariosToYaml } from "./yaml";

describe("generated test-case YAML", () => {
  it("serializes generated scenarios into parser-compatible YAML", () => {
    const scenario: ExecutableScenario = {
      id: "TC_HOME_001",
      title: "Open home page",
      type: "navigation",
      priority: "P2",
      pageUrl: "https://example.com/",
      origin: "ai-generated",
      steps: [
        {
          index: 0,
          description: "Open https://example.com/",
          action: { keyword: "open_page", url: "https://example.com/" },
          resolved: true,
        },
      ],
      expectedResult: { url: "https://example.com/" },
      warnings: [],
    };

    const yaml = scenariosToYaml("https://example.com/", [scenario]);
    const parsed = parseYamlTestCase(yaml);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("TC_HOME_001");
    expect(parsed[0].expectedResult.url).toBe("https://example.com/");
    expect(parsed[0].origin).toBe("testcase-yaml");
  });
});
