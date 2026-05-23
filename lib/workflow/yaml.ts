import { stringify as stringifyYaml } from "yaml";
import type { ExecutableScenario, Priority, ScenarioType } from "../validation";

interface YamlTestCase {
  id: string;
  title: string;
  priority: Priority;
  type: ScenarioType;
  steps: string[];
  expected_result?: string;
  expected_url?: string;
}

interface YamlTestCaseFile {
  page_url: string;
  test_cases: YamlTestCase[];
}

export function scenariosToYaml(
  pageUrl: string,
  scenarios: ExecutableScenario[],
): string {
  const doc: YamlTestCaseFile = {
    page_url: pageUrl,
    test_cases: scenarios.map((scenario) => {
      const item: YamlTestCase = {
        id: scenario.id,
        title: scenario.title,
        priority: scenario.priority,
        type: scenario.type,
        steps: scenario.steps.map((step) => step.description),
      };
      if (scenario.expectedResult.text) item.expected_result = scenario.expectedResult.text;
      if (scenario.expectedResult.url) item.expected_url = scenario.expectedResult.url;
      return item;
    }),
  };
  return stringifyYaml(doc);
}
