import { mkdir } from "node:fs/promises";
import path from "node:path";
import { launchBrowser } from "../browser/launcher";
import { executeAction } from "./keywords";
import type {
  ConsoleMessage,
  ExecutableScenario,
  ScenarioResult,
  StepResult,
} from "../validation";

export interface RunOptions {
  headless?: boolean;
  stepTimeoutMs: number;
  navigationTimeoutMs: number;
  viewport: { width: number; height: number };
  evidenceDir: string;
  captureScreenshotOnSuccess?: boolean;
  storageStatePath?: string;
}

/**
 * Execute scenarios sequentially. Each scenario gets its own browser
 * context (independent storage) and trace file.
 */
export async function runScenarios(
  scenarios: ExecutableScenario[],
  opts: RunOptions,
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runOne(scenario, opts));
  }
  return results;
}

async function runOne(
  scenario: ExecutableScenario,
  opts: RunOptions,
): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  const scenarioDir = path.join(opts.evidenceDir, scenario.id);
  await mkdir(scenarioDir, { recursive: true });

  const session = await launchBrowser({
    headless: opts.headless,
    viewport: opts.viewport,
    navigationTimeoutMs: opts.navigationTimeoutMs,
    storageState: opts.storageStatePath,
  });

  const ctx = {
    page: session.page,
    stepTimeoutMs: opts.stepTimeoutMs,
    navigationTimeoutMs: opts.navigationTimeoutMs,
  };

  const tracePath = path.join(scenarioDir, "trace.zip");
  await session.startTrace(scenarioDir);

  const steps: StepResult[] = [];
  let status: ScenarioResult["status"] = "passed";
  let screenshotPath: string | undefined;
  let finalUrl: string | undefined;
  let finalText: string | undefined;

  for (const step of scenario.steps) {
    const stepStart = Date.now();
    try {
      await executeAction(ctx, step.action);
      const stepResult: StepResult = {
        index: step.index,
        status: "passed",
        durationMs: Date.now() - stepStart,
      };
      if (opts.captureScreenshotOnSuccess) {
        const p = path.join(scenarioDir, `step-${step.index}.png`);
        await session.page
          .screenshot({ path: p, fullPage: false })
          .catch(() => undefined);
        stepResult.screenshotPath = p;
      }
      steps.push(stepResult);
    } catch (err) {
      const reason = classifyError(err);
      const failPng = path.join(scenarioDir, `failure-step-${step.index}.png`);
      await session.page.screenshot({ path: failPng, fullPage: false }).catch(() => undefined);
      steps.push({
        index: step.index,
        status: "failed",
        durationMs: Date.now() - stepStart,
        reason,
        screenshotPath: failPng,
      });
      status = "failed";
      screenshotPath = failPng;
      // halt remaining steps
      const remaining = scenario.steps.slice(scenario.steps.indexOf(step) + 1);
      for (const r of remaining) {
        steps.push({ index: r.index, status: "skipped", durationMs: 0 });
      }
      break;
    }
  }

  try {
    finalUrl = session.page.url();
    finalText = (await session.page.locator("body").innerText({ timeout: 1000 })).slice(0, 5000);
  } catch {
    /* ignore */
  }

  await session.stopTrace(tracePath).catch(() => undefined);
  const consoleMessages: ConsoleMessage[] = session.consoleErrors.map((m) => ({
    level: "error",
    message: m,
  }));
  await session.close();

  return {
    scenarioId: scenario.id,
    status,
    steps,
    startedAt,
    finishedAt: new Date().toISOString(),
    tracePath,
    screenshotPath,
    finalUrl,
    finalText,
    consoleMessages,
  };
}

function classifyError(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err);
  if (/Timeout/i.test(msg)) return "timeout";
  if (/locator/i.test(msg)) return "element not found";
  return msg.slice(0, 500);
}
