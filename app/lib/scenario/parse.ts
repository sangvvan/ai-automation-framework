import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  ExecutableScenario,
  type ExecutableScenario as ExecutableScenarioType,
  type ExpectedResult,
  type ScenarioOrigin,
  type ScenarioStep,
  type ScenarioType,
  Priority,
  ScenarioType as ScenarioTypeEnum,
} from "../validation";

export class TestCaseValidationError extends Error {
  constructor(
    message: string,
    readonly issues: z.ZodIssue[] = [],
  ) {
    super(message);
    this.name = "TestCaseValidationError";
  }
}

const RawStepStringSchema = z.string().min(1);
const RawTestCaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  priority: Priority.optional().default("P2"),
  type: ScenarioTypeEnum.optional().default("positive"),
  steps: z.array(RawStepStringSchema).min(1),
  expected_result: z.string().min(1).optional(),
  expected_url: z.string().min(1).optional(),
});

const RawFileSchema = z.object({
  page_url: z.string().url(),
  test_cases: z.array(RawTestCaseSchema).min(1),
});

export async function parseTestCaseFile(
  filePath: string,
): Promise<ExecutableScenarioType[]> {
  const ext = path.extname(filePath).toLowerCase();
  const text = await readFile(filePath, "utf8");
  if (ext === ".yaml" || ext === ".yml") return parseYamlTestCase(text, filePath);
  if (ext === ".md" || ext === ".markdown") return parseMarkdownTestCase(text, filePath);
  throw new TestCaseValidationError(
    `Unsupported test-case extension: ${ext} (expected .yaml/.yml/.md)`,
  );
}

export function parseYamlTestCase(
  text: string,
  filePath = "<input>",
): ExecutableScenarioType[] {
  const data = parseYaml(text);
  const parsed = RawFileSchema.safeParse(data);
  if (!parsed.success) {
    throw new TestCaseValidationError(
      `${filePath}: ${formatIssues(parsed.error.issues)}`,
      parsed.error.issues,
    );
  }
  return buildScenarios(parsed.data, "testcase-yaml");
}

export function parseMarkdownTestCase(
  text: string,
  filePath = "<input>",
): ExecutableScenarioType[] {
  // Convention:
  //   # TC_<id>: <title>
  //   - page: <url>
  //   - priority: P1|P2|P3
  //   ## Steps
  //   1. ...
  //   2. ...
  //   ## Expected result
  //   <text>  (or:  url: /dashboard)
  const cases: z.infer<typeof RawTestCaseSchema>[] = [];
  let pageUrl: string | undefined;
  const sections = text.split(/(?=^#\s+TC_)/m);
  for (const sec of sections) {
    const titleMatch = sec.match(/^#\s+(TC_[A-Z0-9_]+)(?:\s*:\s*(.+))?/m);
    if (!titleMatch) continue;
    const id = titleMatch[1];
    const title = (titleMatch[2] ?? id).trim();

    const pageMatch = sec.match(/-\s*page\s*:\s*(\S+)/);
    if (pageMatch) pageUrl = pageMatch[1];

    const prioMatch = sec.match(/-\s*priority\s*:\s*(P[123])/);
    const priority = (prioMatch?.[1] ?? "P2") as "P1" | "P2" | "P3";
    const typeMatch = sec.match(/-\s*type\s*:\s*([a-z-]+)/);
    const type = (typeMatch?.[1] ?? "positive") as ScenarioType;

    const stepsBlock = sec.match(/##\s+Steps\s*\n([\s\S]*?)(?=^##\s|^#\s|\Z)/m);
    const steps: string[] = [];
    if (stepsBlock) {
      for (const line of stepsBlock[1].split("\n")) {
        const m = line.match(/^\s*(?:\d+\.|-)\s+(.+)/);
        if (m) steps.push(m[1].trim());
      }
    }

    const expectedBlock = sec.match(/##\s+Expected result\s*\n([\s\S]*?)(?=^##\s|^#\s|\Z)/m);
    const expected = expectedBlock?.[1].trim();
    const expectedUrlMatch = expected?.match(/^url\s*:\s*(.+)$/m);
    const expectedTextMatch = expected?.replace(/^url\s*:.+$/m, "").trim();

    cases.push({
      id,
      title,
      priority,
      type,
      steps,
      expected_result: expectedTextMatch || undefined,
      expected_url: expectedUrlMatch?.[1].trim(),
    });
  }

  if (!pageUrl || cases.length === 0) {
    throw new TestCaseValidationError(
      `${filePath}: could not parse Markdown — missing 'page' or no TC sections`,
    );
  }

  const parsed = RawFileSchema.safeParse({ page_url: pageUrl, test_cases: cases });
  if (!parsed.success) {
    throw new TestCaseValidationError(
      `${filePath}: ${formatIssues(parsed.error.issues)}`,
      parsed.error.issues,
    );
  }
  return buildScenarios(parsed.data, "testcase-md");
}

function buildScenarios(
  raw: z.infer<typeof RawFileSchema>,
  origin: ScenarioOrigin,
): ExecutableScenarioType[] {
  return raw.test_cases.map((tc) => {
    const expectedResult: ExpectedResult = {};
    if (tc.expected_url) expectedResult.url = tc.expected_url;
    if (tc.expected_result) expectedResult.text = tc.expected_result;

    // Initial step set with placeholder actions; mapper rewrites them.
    const steps: ScenarioStep[] = tc.steps.map((s, i) => ({
      index: i,
      description: s,
      action: { keyword: "open_page", url: raw.page_url },
      resolved: false,
    }));

    const scenario: ExecutableScenarioType = {
      id: tc.id,
      title: tc.title,
      type: tc.type,
      priority: tc.priority,
      pageUrl: raw.page_url,
      steps,
      expectedResult,
      origin,
      warnings: [],
    };
    return ExecutableScenario.parse(scenario);
  });
}

function formatIssues(issues: z.ZodIssue[]): string {
  return issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}
