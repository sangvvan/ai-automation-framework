import { mkdir } from "node:fs/promises";
import path from "node:path";
import { launchBrowser, type BrowserName } from "../browser/launcher";
import { executeAction } from "./keywords";
import { runA11yCheck } from "../validator/checks/non-functional/a11y";
import { injectVitalsScript, captureVitals } from "../validator/checks/non-functional/web-vitals";
import { validateSecurityHeaders } from "../validator/checks/non-functional/security-headers";
import type {
  A11yViolation,
  ConsoleMessage,
  ExecutableScenario,
  Locator,
  ScenarioResult,
  StepResult,
  WebVitals,
  SecurityCheck,
  ValidationCheck,
} from "../validation";

export interface NonFunctionalOpts {
  /** Toggle axe-core post-scenario (REQ-013). */
  a11y?: boolean;
  /** Axe impact levels that should fail the scenario. */
  a11yFailOn?: ("minor" | "moderate" | "serious" | "critical")[];
  /** Toggle Web Vitals capture. */
  vitals?: boolean;
  vitalsThresholds?: { lcpMs?: number; cls?: number; inpMs?: number; ttfbMs?: number };
  /** Toggle security-header validation per navigation. */
  securityHeaders?: boolean;
}

export interface RunOptions {
  headless?: boolean;
  stepTimeoutMs: number;
  navigationTimeoutMs: number;
  viewport: { width: number; height: number };
  evidenceDir: string;
  captureScreenshotOnSuccess?: boolean;
  /** Browser engine; default chromium. (REQ-013 multi-browser) */
  browser?: BrowserName;
  /** BCP-47 locale; default unset. (REQ-013 i18n) */
  locale?: string;
  /** Screenshot-baseline + sensitive masking env (REQ-014). */
  baselinesRoot?: string;
  suiteSlug?: string;
  sensitiveSelectors?: string[];
  /** Non-functional post-checks (REQ-013). */
  nonFunctional?: NonFunctionalOpts;
  /** Optional storage-state path. Accept both names for compat. */
  storageState?: string;
  /** Alias for `storageState` (used by workflow subsystem). */
  storageStatePath?: string;
}

/**
 * Execute scenarios sequentially. Each scenario gets its own browser
 * context (independent storage) and trace file.
 */
export async function runScenarios(
  scenarios: ExecutableScenario[],
  opts: RunOptions,
): Promise<{ results: ScenarioResult[]; touched: Locator[][] }> {
  const results: ScenarioResult[] = [];
  const touched: Locator[][] = [];
  let count = 0;
  for (const scenario of scenarios) {
    count++;
    const r = await runOne(scenario, opts);
    results.push(r.result);
    touched.push(r.touched);

    // Live progress log for the CLI & Web UI live output
    const statusSymbol = r.result.status === "passed" ? "✓" : "✗";
    process.stdout.write(
      `    ${statusSymbol} [${count}/${scenarios.length}] Scenario: "${scenario.title}" [${scenario.id}] — ${r.result.status.toUpperCase()}\n`
    );
  }
  return { results, touched };
}

interface RunOneOutcome {
  result: ScenarioResult;
  touched: Locator[];
}

async function runOne(
  scenario: ExecutableScenario,
  opts: RunOptions,
): Promise<RunOneOutcome> {
  const startedAt = new Date().toISOString();
  const scenarioDir = path.join(opts.evidenceDir, scenario.id);
  await mkdir(scenarioDir, { recursive: true });

  const session = await launchBrowser({
    headless: opts.headless,
    viewport: opts.viewport,
    navigationTimeoutMs: opts.navigationTimeoutMs,
    browser: opts.browser,
    locale: opts.locale,
    storageState: opts.storageState ?? opts.storageStatePath,
  });

  if (opts.nonFunctional?.vitals) {
    await injectVitalsScript(session.page).catch(() => undefined);
  }

  // Capture response headers for security-headers validator.
  const securityChecks: SecurityCheck[] = [];
  const extraValidationChecks: ValidationCheck[] = [];
  if (opts.nonFunctional?.securityHeaders) {
    session.page.on("response", async (response) => {
      try {
        // Only check top-level navigations.
        if (response.request().resourceType() !== "document") return;
        const headers = response.headers();
        const cookies = await session.context.cookies(response.url()).catch(() => []);
        const result = validateSecurityHeaders({
          headers,
          url: response.url(),
          cookies: cookies.map((c) => ({
            name: c.name,
            secure: c.secure,
            httpOnly: c.httpOnly,
            sameSite: c.sameSite,
          })),
        });
        securityChecks.push(...result.checks);
        extraValidationChecks.push(...result.validationChecks);
      } catch {
        /* response handler should never throw */
      }
    });
  }

  const ctx = {
    page: session.page,
    stepTimeoutMs: opts.stepTimeoutMs,
    navigationTimeoutMs: opts.navigationTimeoutMs,
    env: opts.baselinesRoot
      ? {
          baselinesRoot: opts.baselinesRoot,
          evidenceDir: scenarioDir,
          suiteSlug: opts.suiteSlug ?? "default",
          scenarioId: scenario.id,
          sensitiveSelectors: opts.sensitiveSelectors,
        }
      : undefined,
  };

  const tracePath = path.join(scenarioDir, "trace.zip");
  await session.startTrace(scenarioDir);

  const steps: StepResult[] = [];
  const touched: Locator[] = [];
  let status: ScenarioResult["status"] = "passed";
  let screenshotPath: string | undefined;
  let finalUrl: string | undefined;
  let finalText: string | undefined;

  for (const step of scenario.steps) {
    const stepStart = Date.now();
    try {
      await executeAction(ctx, step.action);
      // Record touched locators for coverage tracking (REQ-017).
      collectTouched(step.action, touched);
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
      const remaining = scenario.steps.slice(scenario.steps.indexOf(step) + 1);
      for (const r of remaining) {
        steps.push({ index: r.index, status: "skipped", durationMs: 0 });
      }
      break;
    }
  }

  // Post-scenario checks (REQ-013).
  let accessibilityViolations: A11yViolation[] | undefined;
  let webVitals: WebVitals | undefined;

  if (opts.nonFunctional?.a11y && status === "passed") {
    try {
      const a11y = await runA11yCheck(session.page, {
        failOn: opts.nonFunctional.a11yFailOn,
      });
      accessibilityViolations = a11y.violations;
      extraValidationChecks.push(a11y.check);
      if (a11y.check.status === "failed") {
        status = "failed";
      }
    } catch {
      /* swallow — a11y is best-effort */
    }
  }

  if (opts.nonFunctional?.vitals) {
    try {
      const v = await captureVitals(session.page, opts.nonFunctional.vitalsThresholds);
      webVitals = v.vitals;
      extraValidationChecks.push(...v.checks);
    } catch {
      /* best-effort */
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
    result: {
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
      browser: opts.browser ?? "chromium",
      locale: opts.locale,
      accessibilityViolations,
      webVitals,
      securityChecks: securityChecks.length ? securityChecks : undefined,
    },
    touched,
  };
}

function collectTouched(
  action: ExecutableScenario["steps"][number]["action"],
  out: Locator[],
): void {
  if ("target" in action && action.target) out.push(action.target);
  if ("source" in action && action.source) out.push(action.source);
}

function classifyError(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err);
  if (/Timeout/i.test(msg)) return "timeout";
  if (/locator/i.test(msg)) return "element not found";
  return msg.slice(0, 500);
}
