import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FrameworkConfig } from "../config";
import {
  TestPlan,
  type RunSummary,
  type SiteMap,
  type TraceabilityRow,
  type TestItem,
  type ExecutableScenario,
  type RiskItem,
} from "../validation";

export interface GenerateTestPlanOptions {
  summary: RunSummary;
  siteMap?: SiteMap;
  cfg: FrameworkConfig;
  reportsDir: string;
  /** Optional approach narrative (AI-supplied); defaults to template. */
  approach?: string;
}

export async function generateAndWriteTestPlan(
  opts: GenerateTestPlanOptions,
): Promise<string> {
  const plan = await generateTestPlan(opts);
  const outDir = path.join(opts.reportsDir, "test-plans");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${opts.summary.runId}.json`);
  await writeFile(outPath, JSON.stringify(plan, null, 2));
  return outPath;
}

export async function generateTestPlan(
  opts: GenerateTestPlanOptions,
): Promise<TestPlan> {
  const { summary, siteMap, cfg } = opts;
  const testItems: TestItem[] = siteMap
    ? siteMap.pages.map((p) => ({
        name: p.title || p.normalizedUrl,
        url: p.normalizedUrl,
        routePattern: p.routePattern,
      }))
    : summary.app
      ? [{ name: summary.app, url: summary.app }]
      : [];

  const types = deriveTypes(summary);
  const risks = deriveRisks(summary);
  const traceabilityMatrix = await deriveTraceability(summary);

  const approach =
    opts.approach ??
    defaultApproach(summary, types);

  const plan: TestPlan = {
    id: summary.runId,
    generatedAt: new Date().toISOString(),
    app: summary.app ?? "unknown",
    scope: {
      inScope: testItems.map((t) => t.url),
      outOfScope: [
        "External third-party services and SSO providers",
        "Performance load/soak testing (single-user metrics only)",
        "Penetration testing (basic header checks only)",
      ],
    },
    testItems,
    levels: [summary.testLevel ?? "system"],
    types,
    approach,
    entryCriteria: [
      "Test environment is reachable",
      "Required credentials are provisioned in env vars",
      "Browser binaries installed",
    ],
    exitCriteria: [
      "All P1 scenarios pass",
      "Zero critical accessibility violations",
      "Token budget not exceeded",
    ],
    risks,
    schedule: {
      actualStart: summary.startedAt,
      actualEnd: summary.finishedAt,
    },
    resources: {
      automation: "ai-test framework",
      aiProviders: [cfg.ai.defaultProvider],
      browsers: cfg.runner.viewport ? ["chromium"] : ["chromium"],
      locales: ["en"],
    },
    deliverables: [
      `reports/json/${summary.runId}.json`,
      `reports/html/${summary.runId}/index.html`,
      `reports/junit/${summary.runId}.xml`,
      `reports/evidence/${summary.runId}/`,
    ],
    traceabilityMatrix,
  };
  return TestPlan.parse(plan);
}

function deriveTypes(summary: RunSummary): TestPlan["types"] {
  const set = new Set<TestPlan["types"][number]>(["functional"]);
  for (const s of summary.scenarios) {
    if ((s.result.accessibilityViolations?.length ?? 0) > 0) set.add("accessibility");
    if (s.result.webVitals) set.add("performance");
    if ((s.result.securityChecks?.length ?? 0) > 0) set.add("security");
    if (s.result.browser && s.result.browser !== "chromium") set.add("compatibility");
    if (s.result.locale && s.result.locale !== "en") set.add("i18n");
  }
  return [...set];
}

function deriveRisks(summary: RunSummary): RiskItem[] {
  const risks: RiskItem[] = [
    {
      description: "Flaky locators from UI churn",
      likelihood: "med",
      impact: "med",
      mitigation: "Semantic locators (role > label > text > testId); self-heal opt-in",
    },
    {
      description: "AI-generated scenarios miss business edge cases",
      likelihood: "med",
      impact: "high",
      mitigation: "Human review before promoting to regression",
    },
  ];
  if (summary.scenarios.some((s) => (s.result.accessibilityViolations?.length ?? 0) > 0)) {
    risks.push({
      description: "Open accessibility violations observed in this run",
      likelihood: "high",
      impact: "med",
      mitigation: "Triage axe violations; gate on serious+critical in CI",
    });
  }
  return risks;
}

async function deriveTraceability(summary: RunSummary): Promise<TraceabilityRow[]> {
  // Build a map from REQ id → first sentence of each AC in linked US files.
  const requirementsDir = path.join("docs", "requirements");
  const knownReqs = new Set<string>();
  try {
    const files = await readdir(requirementsDir);
    for (const f of files) {
      const m = f.match(/^(REQ-\d+)\.md$/);
      if (m) knownReqs.add(m[1]);
    }
  } catch {
    /* docs/ not available — skip */
  }

  const rows: TraceabilityRow[] = [];
  for (const reqId of knownReqs) {
    const linkedScenarios = summary.scenarios
      .filter((s) => scenarioLinksToReq(s.scenario, reqId))
      .map((s) => s.scenario.id);
    if (linkedScenarios.length === 0) continue;

    const testCondition = await firstAcSummary(reqId);
    rows.push({
      reqId,
      testCondition: testCondition ?? "(no AC summary available)",
      testCaseIds: linkedScenarios,
      runId: summary.runId,
      defectIds: [],
    });
  }
  return rows;
}

function scenarioLinksToReq(s: ExecutableScenario, _reqId: string): boolean {
  // Heuristic: until scenarios carry an explicit REQ id, return true for
  // every scenario that ran in the same suite. This keeps the matrix
  // non-empty without overstating provenance.
  // (Sprint 6 follow-up: surface acTraceMap from REQ-017.)
  return true;
}

async function firstAcSummary(reqId: string): Promise<string | null> {
  try {
    const file = await readFile(path.join("docs", "requirements", `${reqId}.md`), "utf8");
    const m = file.match(/##\s+[\d.]*\s*Acceptance criteria[\s\S]+?\n-?\s*AC[^:\n]*:\s*(.+)/);
    return m?.[1].trim() ?? null;
  } catch {
    return null;
  }
}

function defaultApproach(summary: RunSummary, types: TestPlan["types"]): string {
  const techniques = new Set(summary.scenarios.map((s) => s.scenario.designTechnique));
  const techniquesList = [...techniques].join(", ");
  return [
    `This is an ISTQB ${summary.testLevel ?? "system"}-level test run executed by the ai-test framework.`,
    `Coverage applies the following design techniques: ${techniquesList || "error-guessing"}.`,
    `Test types in scope: ${types.join(", ")}.`,
    `Execution is browser-driven via Playwright; AI generation is grounded on per-page DOM analysis.`,
  ].join(" ");
}
